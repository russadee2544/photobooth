package com.memories.photobooth

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// The Android counterpart of the Windows agent (agent/server.mjs): the same local routes, the same
// window.PhotoboothDevice / PhotoboothPrinter methods, with printing over Bluetooth instead of the
// Windows spooler. The device credential never leaves this process.
class Kiosk(private val context: Context, private val onConfigured: () -> Unit) {
    val config = KioskConfig(context)
    private val printers = PrinterLink(context)
    private val journal = PrintJournal(File(context.filesDir, "print-jobs.json")).apply { load() }
    private val background = Executors.newSingleThreadScheduledExecutor()
    private val startedAt = Instant.now().toString()

    @Volatile private var runtime: Runtime? = null
    @Volatile var page = ""
        private set
    @Volatile private var activityAt = System.currentTimeMillis()
    @Volatile private var paper: Int? = null
    @Volatile private var lastError: String? = null
    @Volatile private var lastErrorAt: String? = null

    private class Runtime(val api: DeviceApi, val printService: PrintService, val handlers: Map<String, Handler>, val groups: JSONObject)

    val configured: Boolean get() = runtime != null

    val updater = Updater(context, "${config.supabaseUrl}/storage/v1/object/public/updates", { config.updateChannel }, ::isIdle) {
        Log.i("Photobooth", it)
    }.also { Updater.current = it }

    // A page was opened (AssetServer): someone is using the kiosk.
    fun onPage(path: String) {
        page = path
        activityAt = System.currentTimeMillis()
    }

    // Like the Windows agent: at the welcome screen nobody has started yet, so an update costs
    // nothing after 20 quiet seconds; anywhere else wait for 10 quiet minutes.
    private fun isIdle(): Boolean {
        val quiet = System.currentTimeMillis() - activityAt
        return if (page == "/home.html" || page == "/index.html" || page.isEmpty()) quiet > 20_000 else quiet > 10 * 60_000
    }

    fun start() {
        if (config.configured) runtime = runCatching { buildRuntime() }.getOrNull()
        // Results the server has not heard about yet, then the dashboard's "I am alive" beat.
        background.scheduleWithFixedDelay({ runCatching { runtime?.printService?.flushUnreported() } }, 5, 30, TimeUnit.SECONDS)
        background.scheduleWithFixedDelay({ runCatching { heartbeat() } }, 10, 60, TimeUnit.SECONDS)
        // New versions of the app (canary/stable channel), installed when the kiosk is idle.
        background.scheduleWithFixedDelay({ if (runtime != null) updater.tick() }, 30, 5 * 60, TimeUnit.SECONDS)
    }

    private fun noteError(message: String) {
        lastError = message.take(300)
        lastErrorAt = Instant.now().toString()
    }

    // ---------------------------------------------------------------- printing

    private fun sendToPrinter(name: String, payload: List<ByteArray>): String {
        val target = name.ifEmpty { config.printerName }
        return when (val result = printers.send(target, payload)) {
            PrinterLink.Result.Sent -> target
            is PrinterLink.Result.NotSent -> throw PrintService.PrintFailure(true, result.reason)
            is PrinterLink.Result.Partial -> throw PrintService.PrintFailure(false, result.reason)
        }
    }

    private fun receiptBytes(images: List<ByteArray>, copies: Int, paperMode: String): List<ByteArray> {
        val dots = EscPos.RECEIPT_DOTS[paperMode] ?: EscPos.RECEIPT_DOTS.getValue("thermal80")
        val gamma = EscPos.gammaOf(config.printLightness)
        return try {
            if (images.size == 1) ReceiptImage.build(images[0], dots, copies, true, gamma)
            else ReceiptImage.buildMany(images, dots, true, gamma)
        } catch (e: Exception) {
            throw PrintService.PrintFailure(true, "invalid_image")
        }
    }

    private fun printImage(image: ByteArray, printerName: String, copies: Int, paperMode: String) =
        sendToPrinter(printerName, receiptBytes(listOf(image), copies, paperMode))

    // ---------------------------------------------------------------- bridge methods

    private fun buildRuntime(): Runtime {
        val api = DeviceApi(config.supabaseUrl, config.publishableKey, config.credential(), config.kioskId, config.packageId)
        val printService = PrintService(object : PrintService.Server {
            override fun startPrint(jobId: String, sessionToken: String) = api.startPrint(jobId, sessionToken)
            override fun reportPrint(jobId: String, result: String) = api.reportPrint(jobId, result)
        }, journal) { image, printerName, copies, paperMode -> printImage(image, printerName, copies, paperMode) }

        val adminRequired = obj("success" to false, "error" to "admin_capability_required")

        // Switching the kiosk mode or printer needs the admin PIN session (like the Windows agent).
        val modeHandlers: Map<String, Handler> = linkedMapOf(
            "setKioskMode" to h { a ->
                val mode = a.optString("mode")
                when {
                    !api.isAdmin() -> adminRequired
                    mode != "event" && mode != "redeem" -> obj("success" to false, "error" to "invalid_mode")
                    else -> { config.mode = mode; obj("success" to true, "mode" to mode) }
                }
            },
            "setPrinterName" to h { a ->
                val name = a.optString("printerName").trim().take(200)
                when {
                    !api.isAdmin() -> adminRequired
                    name.isEmpty() -> obj("success" to false, "error" to "invalid_printer")
                    else -> { config.printerName = name; obj("success" to true, "printerName" to name) }
                }
            },
            // Android sends ESC/POS straight to the printer; there is no printer driver to switch to.
            "setPrintTransport" to h { a ->
                when {
                    !api.isAdmin() -> adminRequired
                    a.optString("transport") == "driver" -> obj("success" to false, "error" to "Android พิมพ์แบบ ESC/POS เท่านั้น")
                    else -> obj("success" to true, "transport" to "escpos")
                }
            },
            "getPrintTransport" to h { _ -> obj("success" to true, "transport" to "escpos", "lightness" to config.printLightness) },
            // How much lighter receipt photos are printed: 0 = as is ... 4 = lightest.
            "setPrintLightness" to h { a ->
                val level = a.optDouble("lightness", Double.NaN)
                when {
                    !api.isAdmin() -> adminRequired
                    level.isNaN() -> obj("success" to false, "error" to "invalid_lightness")
                    else -> {
                        val clamped = Math.round(level).toInt().coerceIn(0, 4)
                        config.printLightness = clamped
                        obj("success" to true, "lightness" to clamped)
                    }
                }
            },
            "reportPageStatus" to h { a ->
                val value = a.optDouble("paper", Double.NaN)
                if (!value.isNaN() && value == Math.floor(value) && value in 0.0..100000.0) paper = value.toInt()
                obj("success" to true)
            },
        )

        // Only the page-facing PhotoboothPrinter surface; start/report stay internal.
        val printerHandlers: Map<String, Handler> = linkedMapOf(
            "printAuthorizedPass" to h { a ->
                val result = printService.printAuthorizedPass(a, config.printerName)
                if (result.optString("status") != "completed") {
                    noteError("print ${result.optString("status")}${result.optString("error").let { if (it.isEmpty()) "" else ": $it" }}")
                }
                result
            },
            // Admin: several slips (redeem codes) in one job, each cut off. Receipt paper only.
            "printSlips" to h { a ->
                if (!api.isAdmin()) adminRequired
                else {
                    val urls = a.optJSONArray("dataUrls") ?: JSONArray()
                    val images = (0 until minOf(urls.length(), 100)).map { PrintService.decodeDataUrl(urls.optString(it)) }
                    if (images.isEmpty() || images.any { it == null }) obj("success" to false, "error" to "invalid_image")
                    else try {
                        val paperMode = a.optString("paperMode").takeIf { it in EscPos.RECEIPT_DOTS } ?: "thermal80"
                        val printer = sendToPrinter(a.optString("printerName").take(200), receiptBytes(images.filterNotNull(), 1, paperMode))
                        obj("success" to true, "printer" to printer, "slips" to images.size)
                    } catch (e: PrintService.PrintFailure) {
                        noteError("slip print: ${e.message}")
                        obj("success" to false, "error" to e.message)
                    }
                }
            },
            // Admin test page: one copy, PIN session required, no entitlement involved.
            "testPrint" to h { a ->
                val image = PrintService.decodeDataUrl(a.optString("dataUrl"))
                when {
                    !api.isAdmin() -> adminRequired
                    image == null -> obj("success" to false, "error" to "invalid_image")
                    else -> try {
                        val printer = printImage(image, a.optString("printerName").take(200), 1, a.optString("paperMode"))
                        obj("success" to true, "printer" to printer)
                    } catch (e: PrintService.PrintFailure) {
                        noteError("test print: ${e.message}")
                        obj("success" to false, "error" to e.message)
                    }
                }
            },
        )

        val groups = obj(
            "PhotoboothDevice" to JSONArray(api.handlers.keys + modeHandlers.keys),
            "PhotoboothPrinter" to JSONArray(printerHandlers.keys),
        )
        return Runtime(api, printService, api.handlers + modeHandlers + printerHandlers, groups)
    }

    // ---------------------------------------------------------------- local routes

    class Reply(val status: Int, val body: JSONObject)

    // Same routes as agent/server.mjs; the page reaches them through android/web/bridge-shim.js.
    fun handle(method: String, path: String, body: String?): Reply {
        val current = runtime ?: return handleSetup(method, path, body)
        return when {
            path == "/__bridge/call" && method == "POST" -> {
                val payload = runCatching { JSONObject(body ?: "{}") }.getOrNull() ?: return Reply(400, obj("error" to "invalid_json"))
                val handler = current.handlers[payload.optString("method")] ?: return Reply(400, obj("error" to "unknown_method"))
                // Background calls from the welcome page are not a customer using the kiosk (keeps updates possible).
                if (payload.optString("method") !in BACKGROUND_METHODS) activityAt = System.currentTimeMillis()
                val args = payload.optJSONObject("args") ?: JSONObject()
                try {
                    Reply(200, handler(args))
                } catch (e: IOException) {
                    Reply(200, obj("error" to "network_error"))
                } catch (e: Exception) {
                    Reply(200, obj("error" to "agent_error"))
                }
            }
            path == "/__agent/status" -> Reply(200, updater.status().put("version", BuildConfig.VERSION_NAME).put("mode", config.mode))
            // Free-event mode only: silent print without an entitlement. Never in redeem mode.
            path == "/api/printers" && method == "GET" -> Reply(200, printers.list(config.printerName))
            path == "/api/direct-print" && method == "POST" && config.mode == "event" -> directPrint(body)
            path.startsWith("/api/") -> Reply(403, obj("error" to "direct_print_disabled"))
            else -> Reply(404, obj("error" to "not_found"))
        }
    }

    private fun directPrint(body: String?): Reply {
        val input = runCatching { JSONObject(body ?: "{}") }.getOrNull() ?: return Reply(400, obj("success" to false, "error" to "invalid_json"))
        val image = PrintService.decodeDataUrl(input.optString("image")) ?: return Reply(400, obj("success" to false, "error" to "invalid_image"))
        val copies = input.optInt("copies", 1).coerceIn(1, 10)
        return try {
            val printer = printImage(image, input.optString("printerName").take(200), copies, input.optString("paperMode"))
            Reply(200, obj("success" to true, "printer" to printer, "copies" to copies))
        } catch (e: PrintService.PrintFailure) {
            noteError("direct print: ${e.message}")
            Reply(500, obj("success" to false, "error" to e.message))
        }
    }

    // First run: the setup page asks for the kiosk id and device credential.
    private fun handleSetup(method: String, path: String, body: String?): Reply = when {
        path == "/__setup/info" && method == "GET" -> Reply(200, printers.list(config.printerName).put("configured", false))
        path == "/__setup/status" && method == "GET" -> Reply(200, obj("configured" to false))
        path == "/__setup/save" && method == "POST" -> saveSetup(body)
        else -> Reply(403, obj("error" to "device_not_provisioned"))
    }

    private fun saveSetup(body: String?): Reply {
        val input = runCatching { JSONObject(body ?: "{}") }.getOrNull() ?: return Reply(400, obj("error" to "invalid_json"))
        val kioskId = input.optString("kioskId").trim()
        val credential = input.optString("credential").trim()
        val packageId = input.optString("packageId").trim()
        val mode = if (input.optString("mode") == "event") "event" else "redeem"
        if (!KIOSK_UUID.matches(kioskId) || credential.length < 20 || (packageId.isNotEmpty() && !KIOSK_UUID.matches(packageId))) {
            return Reply(400, obj("error" to "invalid_input"))
        }
        if (config.supabaseUrl.isEmpty() || config.publishableKey.isEmpty()) return Reply(500, obj("error" to "build_missing_supabase"))

        // Prove the credential works before saving anything.
        val check = try {
            DeviceApi(config.supabaseUrl, config.publishableKey, credential, kioskId, packageId).handlers.getValue("listPassOffers")(JSONObject())
        } catch (e: IOException) {
            return Reply(502, obj("error" to "network_error"))
        }
        if (check.optString("code") == "INVALID_CREDENTIALS") return Reply(500, obj("error" to "build_missing_supabase"))
        val error = check.optString("error")
        if (error.startsWith("device_") || error == "bad_upstream_response") return Reply(401, obj("error" to "credential_rejected"))

        if (!config.save(kioskId, credential, packageId, mode, input.optString("printerName").take(200))) {
            return Reply(500, obj("error" to "config_write_failed"))
        }
        config.updateChannel = input.optString("updateChannel")
        runtime = buildRuntime()
        onConfigured()
        return Reply(200, obj("ok" to true))
    }

    // ---------------------------------------------------------------- page script + dashboard

    // The script every kiosk page loads first (/__bridge.js): the fetch shim, plus the Windows
    // agent's own bridge client once the kiosk is set up (android/scripts/bridge-client.mjs).
    fun bridgeScript(): String {
        val shim = asset("pb/bridge-shim.js")
        val current = runtime ?: return shim
        val client = asset("pb/bridge-client.js")
            .replace("\"@@PB_KIOSK_ID@@\"", JSONObject.quote(config.kioskId))
            .replace("\"@@PB_PACKAGE_ID@@\"", JSONObject.quote(config.packageId))
            .replace("\"@@PB_MODE@@\"", JSONObject.quote(config.mode))
            .replace("\"@@PB_GROUPS@@\"", current.groups.toString())
        return "$shim\n$client"
    }

    private fun asset(name: String) = context.assets.open(name).bufferedReader().use { it.readText() }

    private fun heartbeat() {
        val api = runtime?.api ?: return
        val reply = api.heartbeat(obj(
            "kioskId" to config.kioskId,
            "version" to BuildConfig.VERSION_NAME,
            "channel" to config.updateChannel,
            "mode" to config.mode,
            "page" to page,
            "startedAt" to startedAt,
            "printerName" to config.printerName,
            "printerState" to printers.state,
            "printerDetail" to printers.detail,
            "paperRemaining" to (paper ?: JSONObject.NULL),
            "lastError" to (lastError ?: updater.lastError?.let { "update: $it" } ?: JSONObject.NULL),
            "lastErrorAt" to (lastErrorAt ?: JSONObject.NULL),
        ))
        if (reply.has("error")) android.util.Log.w("Photobooth", "heartbeat failed: ${reply.optString("error")}")
    }

    private companion object {
        val BACKGROUND_METHODS = setOf("reportPageStatus", "themeLatest", "themeFetch")
        val KIOSK_UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    }
}
