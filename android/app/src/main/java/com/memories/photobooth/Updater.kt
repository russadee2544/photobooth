package com.memories.photobooth

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Self-update for the Android app, the counterpart of agent/updater.mjs on Windows.
//
// Flow: poll <supabase>/storage/v1/object/public/updates/android/<channel>.json -> download the
// APK -> check size + sha256 -> check it is this app, newer, and signed with the same key as the
// installed app -> install it when the kiosk is idle. Android itself refuses an update signed with
// any other key, so that key (android/scripts/build-apk.mjs) is what makes an update trusted.
class Updater(
    private val context: Context,
    private val baseUrl: String,
    private val channel: () -> String,
    private val isIdle: () -> Boolean,
    private val log: (String) -> Unit,
) {
    private val prefs = context.getSharedPreferences("updates", Context.MODE_PRIVATE)
    private val dir = File(context.filesDir, "updates")
    @Volatile var lastError: String? = null
        private set
    @Volatile private var ready: Release? = null
    @Volatile private var installing = false

    class Release(val versionCode: Long, val versionName: String, val file: File)

    // Every few minutes: look for a newer release, download it, and install it once the kiosk is idle.
    fun tick() {
        if (installing) return
        try {
            if (ready == null) ready = fetchNewer()
            val release = ready ?: return
            if (isIdle()) install(release)
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            log("update: $lastError")
        }
    }

    fun status(): JSONObject = obj("channel" to channel(), "pending" to ready?.versionName, "lastError" to lastError)

    private fun fetchNewer(): Release? {
        val manifest = JSONObject(get("$baseUrl/android/${channel()}.json?t=${System.currentTimeMillis()}") ?: return null)
        val code = manifest.optLong("versionCode")
        val name = manifest.optString("versionName")
        val sha256 = manifest.optString("sha256")
        val size = manifest.optLong("size")
        val path = manifest.optString("path")
        if (code <= currentVersionCode() || code in failed()) return null
        require(SHA256.matches(sha256) && size in 1..MAX_APK_BYTES && path == "android/releases/$code.apk") { "invalid_manifest" }

        dir.mkdirs()
        dir.listFiles()?.filter { it.name != "$code.apk" }?.forEach { it.delete() }
        val apk = File(dir, "$code.apk")
        if (!(apk.length() == size && sha256Of(apk) == sha256)) download("$baseUrl/$path", apk, size)
        require(apk.length() == size && sha256Of(apk) == sha256) { "checksum_mismatch" }
        require(isSameAppNewerAndSigned(apk, code)) { "not_signed_by_this_app" }
        log("update: $name downloaded, installs when idle")
        return Release(code, name, apk)
    }

    private fun install(release: Release) {
        installing = true
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            // Android 12+: an app updating itself may skip the "Update this app?" question.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, release.file.length()).use { out ->
                    release.file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val callback = PendingIntent.getBroadcast(context, sessionId,
                    Intent(context, InstallResultReceiver::class.java).putExtra(EXTRA_VERSION_CODE, release.versionCode),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                log("update: installing ${release.versionName}")
                // On success Android stops this app and replaces it; AppReplacedReceiver opens it again.
                session.commit(callback.intentSender)
            }
        } catch (e: Exception) {
            installing = false
            runCatching { installer.abandonSession(sessionId) }
            throw e
        }
    }

    // Called from InstallResultReceiver when Android could not (or would not) install the update.
    fun onInstallFailed(versionCode: Long, message: String) {
        installing = false
        ready = null
        val tries = prefs.getInt("tries-$versionCode", 0) + 1
        prefs.edit().putInt("tries-$versionCode", tries).apply()
        // A release that keeps failing is not tried again (a newer one will be).
        if (tries >= MAX_TRIES) prefs.edit().putStringSet("failed", failed().map { it.toString() }.toSet() + versionCode.toString()).apply()
        lastError = "install $versionCode: $message"
        log("update: $lastError")
    }

    private fun failed(): Set<Long> = prefs.getStringSet("failed", emptySet())!!.mapNotNull { it.toLongOrNull() }.toSet()

    private fun currentVersionCode(): Long = BuildConfig.VERSION_CODE.toLong()

    @Suppress("DEPRECATION")
    private fun isSameAppNewerAndSigned(apk: File, code: Long): Boolean {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = context.packageManager.getPackageArchiveInfo(apk.path, flags) ?: return false
        val installed = packageInfo(context.packageName, flags) ?: return false
        return archive.packageName == context.packageName && versionCodeOf(archive) == code &&
            signers(archive).isNotEmpty() && signers(archive) == signers(installed)
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures.orEmpty().map { it.toCharsString() }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun versionCodeOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun packageInfo(name: String, flags: Int): PackageInfo? = runCatching {
        if (Build.VERSION.SDK_INT >= 33) context.packageManager.getPackageInfo(name, PackageManager.PackageInfoFlags.of(flags.toLong()))
        else context.packageManager.getPackageInfo(name, flags)
    }.getOrNull()

    private fun get(url: String): String? {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.useCaches = false
            if (connection.responseCode == 404 || connection.responseCode == 400) return null   // nothing published yet
            if (connection.responseCode != 200) throw IllegalStateException("manifest_http_${connection.responseCode}")
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun download(url: String, target: File, size: Long) {
        val partial = File(target.path + ".part")
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            if (connection.responseCode != 200) throw IllegalStateException("download_http_${connection.responseCode}")
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > size) throw IllegalStateException("download_too_large")
                        output.write(buffer, 0, n)
                    }
                }
            }
            if (!partial.renameTo(target)) throw IllegalStateException("download_save_failed")
        } finally {
            connection.disconnect()
            partial.delete()
        }
    }

    private fun sha256Of(file: File): String {
        if (!file.exists()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val EXTRA_VERSION_CODE = "com.memories.photobooth.VERSION_CODE"
        private const val MAX_APK_BYTES = 200L * 1024 * 1024
        private const val MAX_TRIES = 3
        private val SHA256 = Regex("^[0-9a-f]{64}$")

        // The running app's updater, for the install-result receiver.
        @Volatile var current: Updater? = null
    }
}

// Android's answer to session.commit().
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val versionCode = intent.getLongExtra(Updater.EXTRA_VERSION_CODE, 0)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            // Android wants a person to confirm ("Update this app?"): show its screen on the kiosk.
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                runCatching { context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit   // the app is being replaced
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status_$status"
                Log.w("Photobooth", "update install failed: $message")
                Updater.current?.onInstallFailed(versionCode, message)
            }
        }
    }
}

// After an update Android has stopped the app: bring the kiosk screen back. (When the app is the
// phone's Home app, Android reopens it by itself; this covers the rest where Android allows it.)
class AppReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        runCatching {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
