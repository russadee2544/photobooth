package com.memories.photobooth

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.Executors

// Full-screen kiosk: one WebView showing the bundled kiosk pages, with the native bridge
// (Kiosk) behind window.PBNative. The screen stays on; the back button does nothing.
class MainActivity : Activity() {
    private lateinit var kiosk: Kiosk
    private lateinit var assets: AssetServer
    private var webView: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private val bridgeCalls = Executors.newCachedThreadPool()

    private var pendingPermission: PermissionRequest? = null
    private var pendingFiles: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        kiosk = Kiosk(applicationContext) {
            main.post {
                webView?.loadUrl(START_URL)
                askInstallPermissionOnce()
            }
        }
        kiosk.start()
        assets = AssetServer(applicationContext, kiosk)
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { /* kiosk: stay */ }
        }
        askPermissions()
        createWebView()
    }

    @Deprecated("Kiosk: the back button stays on the page")
    override fun onBackPressed() { /* kiosk: stay */ }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val view = WebView(this)
        view.setBackgroundColor(Color.WHITE)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100   // the phone's font size setting must not break the kiosk layout
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString PhotoboothAndroid/${BuildConfig.VERSION_NAME}"
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            view.loadDataWithBaseURL(null, UPDATE_WEBVIEW_HTML, "text/html", "utf-8", null)
            setContentView(view)
            webView = view
            return
        }
        // The bridge exists only for pages from the app's own origin.
        WebViewCompat.addWebMessageListener(view, "PBNative", setOf(AssetServer.ORIGIN)) { _, message, _, isMainFrame, reply ->
            val data = message.data ?: return@addWebMessageListener
            if (!isMainFrame) return@addWebMessageListener
            bridgeCalls.execute {
                val answer = runCatching {
                    val call = JSONObject(data)
                    val id = call.opt("id")
                    val body = if (call.isNull("body")) null else call.optString("body")
                    val result = kiosk.handle(call.optString("method", "GET").uppercase(), call.optString("path"), body)
                    obj("id" to id, "status" to result.status, "body" to result.body.toString())
                }.getOrElse {
                    Log.e(TAG, "bridge call failed", it)
                    obj("id" to runCatching { JSONObject(data).opt("id") }.getOrNull(), "status" to 500, "body" to "{\"error\":\"agent_error\"}")
                }
                main.post { runCatching { reply.postMessage(answer.toString()) } }
            }
        }

        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.serve(request)

            // Kiosk: stay on the app's own pages; links elsewhere do nothing.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "https" && url.host == AssetServer.HOST) return false
                Log.i(TAG, "blocked navigation to ${url.scheme}://${url.host}")
                return true
            }

            // The page renderer died (out of memory on a small phone): start over on a fresh WebView.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e(TAG, "renderer gone, crashed=${detail.didCrash()}")
                (view.parent as? android.view.ViewGroup)?.removeView(view)
                view.destroy()
                webView = null
                main.post { createWebView() }
                return true
            }
        }

        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                main.post { answerPermission(request) }
            }

            // Admin pages upload frames, theme files and colour looks.
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                pendingFiles?.onReceiveValue(null)
                pendingFiles = callback
                return try {
                    startActivityForResult(params.createIntent(), REQUEST_FILES)
                    true
                } catch (e: Exception) {
                    pendingFiles = null
                    false
                }
            }

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(TAG, "page: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                }
                return true
            }
        }

        setContentView(view)
        webView = view
        view.loadUrl(START_URL)
    }

    // ---- camera + Bluetooth permissions -------------------------------------------------------

    private fun askPermissions() {
        val wanted = mutableListOf(Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT >= 31) wanted += Manifest.permission.BLUETOOTH_CONNECT
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        // The install-permission screen comes after these answers, so it cannot cancel the questions.
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQUEST_PERMISSIONS)
        else if (kiosk.configured) askInstallPermissionOnce()
    }

    // Self-update needs "Install unknown apps" for this app; Android only lets a person switch it on.
    // Open that screen once, after setup; the staff turns it on and presses Back.
    private fun askInstallPermissionOnce() {
        val prefs = getSharedPreferences("kiosk-ui", MODE_PRIVATE)
        if (packageManager.canRequestPackageInstalls() || prefs.getBoolean("askedInstallPermission", false)) return
        prefs.edit().putBoolean("askedInstallPermission", true).apply()
        runCatching {
            startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
        }
    }

    // The camera is given to the app's own pages only, and only video (the kiosk never records sound).
    private fun answerPermission(request: PermissionRequest) {
        if (request.origin.host != AssetServer.HOST || PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) {
            request.deny()
            return
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            pendingPermission?.deny()
            pendingPermission = request
            requestPermissions(arrayOf(Manifest.permission.CAMERA), REQUEST_CAMERA)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PERMISSIONS && kiosk.configured) askInstallPermissionOnce()
        val request = pendingPermission ?: return
        if (requestCode != REQUEST_CAMERA && Manifest.permission.CAMERA !in permissions) return
        pendingPermission = null
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            request.deny()
        }
    }

    @Deprecated("Plain Activity API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_FILES) return
        pendingFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        pendingFiles = null
    }

    // ---- full screen --------------------------------------------------------------------------

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    private companion object {
        const val TAG = "Photobooth"
        const val START_URL = "${AssetServer.ORIGIN}/home.html"
        const val REQUEST_PERMISSIONS = 1
        const val REQUEST_CAMERA = 2
        const val REQUEST_FILES = 3
        const val UPDATE_WEBVIEW_HTML = "<html><body style='font:20px sans-serif;padding:32px'>" +
            "<h2>ต้องอัปเดต Android System WebView</h2><p>เปิด Play Store แล้วอัปเดต \"Android System WebView\" " +
            "และ \"Google Chrome\" จากนั้นเปิดแอปนี้อีกครั้ง</p></body></html>"
    }
}
