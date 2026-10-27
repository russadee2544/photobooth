package com.memories.photobooth

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.OffsetDateTime
import java.util.concurrent.ConcurrentHashMap

typealias Handler = (JSONObject) -> JSONObject

// Gives a bridge method lambda its type: "name" to h { args -> result }
fun h(block: Handler): Handler = block

// JSON object from pairs; a Kotlin null leaves the key out (like `undefined` in JSON.stringify),
// JSONObject.NULL writes an explicit null.
fun obj(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply {
    for ((key, value) in pairs) if (value != null) put(key, value)
}

// `a.x ?? null`
fun JSONObject.orNull(key: String): Any = opt(key) ?: JSONObject.NULL

// Port of bridge/core.mjs (the Windows agent's native bridge). It holds the device credential
// and admin capability in this process only; the page gets a fixed set of methods and never a
// generic "call any function". Keep the method list in step with core.mjs
// (android/scripts/bridge-client.test.mjs checks it).
class DeviceApi(
    private val supabaseUrl: String,
    private val publishableKey: String,
    private val credential: String,
    private val kioskId: String,
    private val packageId: String,
) {
    @Volatile private var adminToken = ""
    @Volatile private var adminExpiresAt = 0L
    // passId -> raw code, as returned once by generatePass (memory only).
    private val rawCodes = ConcurrentHashMap<String, String>()

    fun callFunction(fn: String, body: JSONObject, extraHeaders: Map<String, String> = emptyMap()): JSONObject {
        val payload = JSONObject().put("kioskId", kioskId)
        for (key in body.keys()) payload.put(key, body.get(key))
        val connection = URL("$supabaseUrl/functions/v1/$fn").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            connection.setRequestProperty("apikey", publishableKey)
            connection.setRequestProperty("x-kiosk-credential", credential)
            for ((name, value) in extraHeaders) connection.setRequestProperty(name, value)
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return runCatching { JSONObject(text) }.getOrElse { obj("error" to "bad_upstream_response") }
        } finally {
            connection.disconnect()
        }
    }

    private fun adminValid() = adminToken.isNotEmpty() && adminExpiresAt > System.currentTimeMillis()
    fun isAdmin() = adminValid()

    private fun keepCapability(result: JSONObject) {
        val token = result.optString("capabilityToken")
        if (token.isEmpty()) return
        val expires = runCatching { OffsetDateTime.parse(result.optString("expiresAt")).toInstant().toEpochMilli() }.getOrNull()
        adminToken = token
        adminExpiresAt = expires ?: (System.currentTimeMillis() + ADMIN_SESSION_FALLBACK_MS)
    }

    private fun withAdmin(fn: String, body: JSONObject): JSONObject =
        if (adminValid()) callFunction(fn, body, mapOf("x-admin-capability" to adminToken))
        else obj("success" to false, "error" to "admin_capability_required")

    val handlers: Map<String, Handler> = linkedMapOf(
        "listPassOffers" to h { _ -> callFunction("payment-order", obj("operation" to "offers")) },
        "createPaymentOrder" to h { a -> callFunction("payment-order", obj("operation" to "create", "packageId" to a.opt("packageId"), "quotaKind" to a.opt("quotaKind"))) },
        "getPaymentOrder" to h { a -> callFunction("payment-order", obj("operation" to "status", "orderId" to a.opt("orderId"))) },
        "cancelPaymentOrder" to h { a -> callFunction("payment-order", obj("operation" to "cancel", "orderId" to a.opt("orderId"))) },
        "claimPrintPass" to h { a -> callFunction("redeem-pass", obj("operation" to "claim", "code" to a.opt("code"), "previousToken" to a.orNull("previousToken"))) },
        "touchPrintPass" to h { a -> callFunction("redeem-pass", obj("operation" to "touch", "passId" to a.opt("passId"), "sessionToken" to a.opt("sessionToken"))) },
        "reservePrintPass" to h { a ->
            callFunction("redeem-pass", obj("operation" to "reserve", "passId" to a.opt("passId"), "sessionToken" to a.opt("sessionToken"),
                "jobId" to a.opt("jobId"), "assetSha256" to a.opt("assetSha256")))
        },
        "pausePrintPass" to h { a -> callFunction("redeem-pass", obj("operation" to "pause", "passId" to a.opt("passId"), "sessionToken" to a.opt("sessionToken"))) },
        "issuePhotoUploadTicket" to h { a ->
            callFunction("session-photo", obj("operation" to "ticket", "sessionId" to a.opt("sessionId"), "mode" to a.opt("mode"),
                "eventName" to (a.opt("eventName") ?: ""), "layout" to (a.opt("layout") ?: "")))
        },
        "issueGifUploadTicket" to h { a ->
            callFunction("session-gif", obj("operation" to "ticket", "sessionId" to a.opt("sessionId"), "mode" to a.opt("mode"),
                "passId" to a.orNull("passId"), "sessionToken" to a.orNull("sessionToken"), "packageId" to a.orNull("packageId")))
        },

        "adminPinStatus" to h { _ ->
            val status = callFunction("admin-pin", obj("operation" to "status"))
            status.put("authenticated", adminValid()).put("expiresAt", if (adminValid()) adminExpiresAt else JSONObject.NULL)
        },
        "adminEnrollPin" to h { a ->
            val result = callFunction("admin-pin", obj("operation" to "enroll", "pin" to a.opt("pin")))
            keepCapability(result)
            if (result.optBoolean("success")) obj("success" to true, "expiresAt" to adminExpiresAt)
            else obj("success" to false, "error" to result.opt("error"))
        },
        "adminVerifyPin" to h { a ->
            val result = callFunction("admin-pin", obj("operation" to "verify", "pin" to a.opt("pin")))
            if (!result.optBoolean("valid")) obj("valid" to false, "error" to result.opt("error"), "lockedUntil" to result.orNull("lockedUntil"))
            else {
                keepCapability(result)
                obj("valid" to true, "expiresAt" to adminExpiresAt)
            }
        },
        "adminChangePin" to h { a ->
            val result = callFunction("admin-pin", obj("operation" to "change", "currentPin" to a.opt("currentPin"), "nextPin" to a.opt("nextPin")))
            if (result.optBoolean("success")) {
                adminToken = ""; adminExpiresAt = 0
                obj("success" to true)
            } else obj("success" to false, "error" to result.opt("error"))
        },
        "adminLogout" to h { _ ->
            adminToken = ""; adminExpiresAt = 0
            obj("success" to true)
        },
        "generatePrintPasses" to h { a ->
            val result = withAdmin("admin-redeem", obj("operation" to "generatePass",
                "packageId" to a.optString("packageId").ifEmpty { packageId },
                "count" to a.opt("count"), "expiresDays" to a.opt("expiresDays"), "quotaKind" to a.opt("quotaKind")))
            if (!result.optBoolean("success")) obj("success" to false, "codes" to JSONArray(), "batchId" to JSONObject.NULL, "error" to result.opt("error"))
            else {
                val rows = result.optJSONArray("codes") ?: JSONArray()
                val codes = JSONArray()
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    rawCodes[row.optString("passId")] = row.optString("code")
                    codes.put(row.opt("code"))
                }
                obj("success" to true, "codes" to codes, "batchId" to JSONObject.NULL, "expiresAt" to result.opt("expiresAt"))
            }
        },
        // Event photos: admin only (device credential + PIN capability, both held here).
        "listEventPhotos" to h { _ -> withAdmin("event-photos", obj("operation" to "list")) },
        "deleteEventPhotos" to h { a -> withAdmin("event-photos", obj("operation" to "delete", "ids" to a.opt("ids"), "reason" to a.opt("reason"))) },
        // Shared themes: every kiosk reads the current set; publishing it needs the PIN session.
        "themeLatest" to h { _ -> callFunction("theme-sync", obj("operation" to "latest")) },
        "themeFetch" to h { _ -> callFunction("theme-sync", obj("operation" to "fetch")) },
        "themePublish" to h { a -> withAdmin("theme-sync", obj("operation" to "publish", "bundle" to a.opt("bundle"))) },
        // Looks for the phone photo studio (main kiosk only, PIN session).
        "publishStudioLooks" to h { a -> withAdmin("theme-sync", obj("operation" to "publishLooks", "looks" to a.opt("looks"), "defaults" to a.opt("defaults"))) },
        "listPrintPasses" to h { _ ->
            val result = withAdmin("admin-redeem", obj("operation" to "listPass"))
            if (!result.optBoolean("success")) obj("success" to false, "codes" to JSONArray(), "error" to result.opt("error"))
            else {
                val rows = result.optJSONArray("codes") ?: JSONArray()
                val codes = JSONArray()
                for (i in 0 until rows.length()) {
                    val row = JSONObject((rows.optJSONObject(i) ?: continue).toString())
                    val passId = row.optString("pass_id")
                    val limit = row.opt("print_limit")
                    row.put("id", row.opt("pass_id") ?: JSONObject.NULL)
                    row.put("code", rawCodes[passId] ?: JSONObject.NULL)
                    row.put("is_used", row.optString("quota_kind") != "unlimited" && limit != null && limit != JSONObject.NULL &&
                        row.optDouble("used_prints", 0.0) >= row.optDouble("print_limit"))
                    codes.put(row)
                }
                obj("success" to true, "codes" to codes)
            }
        },
    )

    // `start` / `report` are internal: only the printer module may call them.
    fun startPrint(jobId: String, sessionToken: String) =
        callFunction("redeem-pass", obj("operation" to "start", "jobId" to jobId, "sessionToken" to sessionToken))

    fun reportPrint(jobId: String, result: String) =
        callFunction("redeem-pass", obj("operation" to "report", "jobId" to jobId, "result" to result))

    fun heartbeat(payload: JSONObject) = callFunction("kiosk-heartbeat", payload)

    private companion object {
        const val ADMIN_SESSION_FALLBACK_MS = 15 * 60 * 1000L
    }
}
