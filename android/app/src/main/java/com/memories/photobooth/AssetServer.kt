package com.memories.photobooth

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException

// Serves the kiosk pages bundled in the APK (assets/www, the `vite build` output) on a private
// https origin, and puts /__bridge.js in front of every page's own scripts, as the Windows agent does.
class AssetServer(private val context: Context, private val kiosk: Kiosk) {

    fun serve(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.scheme != "https" || url.host != HOST) return null   // the internet: WebView fetches it
        var path = url.path ?: "/"
        if (path.split('/').any { it == ".." }) return notFound()
        if (path == "/") path = "/index.html"

        if (path == "/__bridge.js") return text("text/javascript", kiosk.bridgeScript())
        if (path.endsWith(".html")) {
            kiosk.onPage(path)
            // Until the kiosk is set up, every page is the setup form.
            val html = if (kiosk.configured) read("www$path") ?: return notFound() else read("pb/setup.html")!!
            return text("text/html", html.replaceFirst(HEAD, "$0<script src=\"/__bridge.js\"></script>"))
        }
        return try {
            WebResourceResponse(mime(path), null, 200, "OK", mapOf("Cache-Control" to "no-cache"), context.assets.open("www$path"))
        } catch (e: FileNotFoundException) {
            notFound()
        }
    }

    private fun read(asset: String): String? = try {
        context.assets.open(asset).bufferedReader().use { it.readText() }
    } catch (e: FileNotFoundException) {
        null
    }

    private fun text(type: String, body: String) = WebResourceResponse(type, "utf-8", 200, "OK",
        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(body.toByteArray(Charsets.UTF_8)))

    private fun notFound() = WebResourceResponse("application/json", "utf-8", 404, "Not Found",
        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream("{\"error\":\"not_found\"}".toByteArray()))

    private fun mime(path: String) = MIME[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

    companion object {
        // Reserved for apps by Android (androidx.webkit); never a real site.
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        private val HEAD = Regex("<head[^>]*>", RegexOption.IGNORE_CASE)
        private val MIME = mapOf(
            "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
            "json" to "application/json", "webmanifest" to "application/manifest+json", "png" to "image/png",
            "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "gif" to "image/gif", "webp" to "image/webp",
            "svg" to "image/svg+xml", "ico" to "image/x-icon", "woff2" to "font/woff2", "woff" to "font/woff",
            "ttf" to "font/ttf", "txt" to "text/plain", "cube" to "text/plain", "mp4" to "video/mp4", "wasm" to "application/wasm",
        )
    }
}
