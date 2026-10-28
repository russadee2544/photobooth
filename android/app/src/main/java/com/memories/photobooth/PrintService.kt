package com.memories.photobooth

import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64

// Authorized-print state machine, a port of agent/print-pass.mjs (docs/REDEEM_NATIVE_BRIDGE.md).
// Dependencies are passed in so the rules can be tested without Android, a printer or the network.
class PrintService(
    private val server: Server,
    private val journal: PrintJournal,
    private val printImage: ImagePrinter,
) {
    interface Server {
        fun startPrint(jobId: String, sessionToken: String): JSONObject
        fun reportPrint(jobId: String, result: String): JSONObject
    }

    fun interface ImagePrinter {
        // Throws PrintFailure; notPrinted = true only when provably nothing reached the printer.
        fun print(image: ByteArray, printerName: String, copies: Int, paperMode: String)
    }

    class PrintFailure(val notPrinted: Boolean, reason: String) : Exception(reason)

    // Report a result to the server; remember it for retry if the network fails.
    private fun report(jobId: String, result: String): JSONObject? {
        val reply = runCatching { server.reportPrint(jobId, result) }.getOrElse { obj("error" to "network_error") }
        if (reply.has("error")) {
            journal.set(jobId, "unreported" to result)
            return null
        }
        if (result == "completed" && reply.optString("status") != "completed") {
            journal.set(jobId, "state" to "ambiguous", "unreported" to null)
            return null
        }
        if (result == "ambiguous") journal.set(jobId, "unreported" to null)
        else journal.set(jobId, "unreported" to null, "state" to result, "remaining" to reply.opt("remaining"))
        return reply
    }

    fun flushUnreported() {
        for ((jobId, result) in journal.unreported()) report(jobId, result)
    }

    fun printAuthorizedPass(a: JSONObject, defaultPrinter: String): JSONObject {
        val jobId = a.optString("jobId")
        val sessionToken = a.optString("sessionToken")
        if (!UUID_RE.matches(jobId) || !TOKEN_RE.matches(sessionToken)) return obj("status" to "failed", "error" to "invalid_request")
        val dataUrl = a.optString("dataUrl")
        val image = decodeDataUrl(dataUrl) ?: return obj("status" to "failed", "error" to "invalid_image")

        // The same jobId is never sent to the printer twice, whatever the page asks.
        journal.get(jobId)?.let { known ->
            return when (known.optString("state")) {
                "completed" -> obj("status" to "completed", "remaining" to known.orNull("remaining"), "copiesCompleted" to known.opt("copies"))
                "failed" -> obj("status" to "failed")
                else -> obj("status" to "ambiguous")
            }
        }

        val start = runCatching { server.startPrint(jobId, sessionToken) }.getOrElse { obj("error" to "network_error") }
        if (start.has("error") || start.optString("status") != "printing") {
            return obj("status" to "failed", "error" to (start.opt("error") ?: "start_failed"))
        }

        // The asset comes from the server's reservation, never from the browser; the browser may only ask
        // for fewer copies than the pass allows (the kiosk's "copies per print" setting).
        val allowed = start.optInt("copies", 0)
        val copies = a.optDouble("copies", Double.NaN)
        if (start.optString("assetSha256") != sha256Hex(dataUrl) || !(copies >= 1 && copies <= allowed) || copies != Math.floor(copies)) {
            journal.set(jobId, "state" to "failed", "copies" to allowed)
            report(jobId, "failed")
            return obj("status" to "failed", "error" to "asset_mismatch")
        }

        // Persist BEFORE touching the printer so a crash cannot cause a re-send.
        journal.set(jobId, "state" to "printing", "copies" to copies.toInt(), "sha" to start.optString("assetSha256"))
        try {
            val chosen = a.optString("printerName").trim().take(200)
            printImage.print(image, chosen.ifEmpty { defaultPrinter }, copies.toInt(), a.optString("paperMode"))
        } catch (e: PrintFailure) {
            if (e.notPrinted) {
                journal.set(jobId, "state" to "failed")
                report(jobId, "failed")
                return obj("status" to "failed", "error" to "printer_unavailable")
            }
            journal.set(jobId, "state" to "ambiguous")
            report(jobId, "ambiguous")
            return obj("status" to "ambiguous")
        } catch (e: Exception) {
            journal.set(jobId, "state" to "ambiguous")
            report(jobId, "ambiguous")
            return obj("status" to "ambiguous")
        }

        val reply = report(jobId, "completed")
        if (reply == null) {
            journal.set(jobId, "state" to "ambiguous", "unreported" to "completed")
            return obj("status" to "ambiguous")
        }
        journal.set(jobId, "state" to "completed", "remaining" to reply.opt("remaining"))
        return obj("status" to "completed", "remaining" to reply.orNull("remaining"), "copiesCompleted" to copies.toInt())
    }

    companion object {
        private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private val TOKEN_RE = Regex("^[0-9a-f]{64}$")
        private val DATA_URL_PREFIXES = listOf("data:image/png;base64,", "data:image/jpeg;base64,")
        private const val MAX_IMAGE_BYTES = 20 * 1024 * 1024

        fun sha256Hex(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

        // data:image/png|jpeg;base64,... (the strict decoder rejects anything outside the base64 alphabet).
        fun decodeDataUrl(dataUrl: String): ByteArray? {
            val prefix = DATA_URL_PREFIXES.firstOrNull { dataUrl.startsWith(it) } ?: return null
            val bytes = runCatching { Base64.getDecoder().decode(dataUrl.substring(prefix.length)) }.getOrNull() ?: return null
            return if (bytes.isNotEmpty() && bytes.size <= MAX_IMAGE_BYTES) bytes else null
        }
    }
}
