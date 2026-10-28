package com.memories.photobooth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The kiosk's settings, like the Windows agent's config.json. The device credential is
// encrypted with a key that never leaves the Android Keystore (the agent uses DPAPI).
class KioskConfig(private val context: Context) {
    private val prefs = context.getSharedPreferences("kiosk", Context.MODE_PRIVATE)

    // Supabase URL + publishable key (public by design), written into the APK at build time.
    val supabaseUrl: String
    val publishableKey: String

    init {
        val defaults = runCatching {
            JSONObject(context.assets.open("pb/defaults.json").bufferedReader().use { it.readText() })
        }.getOrDefault(JSONObject())
        supabaseUrl = defaults.optString("supabaseUrl").trimEnd('/')
        publishableKey = defaults.optString("publishableKey")
    }

    val configured: Boolean get() = kioskId.isNotEmpty() && prefs.contains(KEY_CREDENTIAL)
    val kioskId: String get() = prefs.getString("kioskId", "") ?: ""
    val packageId: String get() = prefs.getString("packageId", "") ?: ""

    var mode: String
        get() = if (prefs.getString("mode", "redeem") == "event") "event" else "redeem"
        set(value) { prefs.edit().putString("mode", value).commit() }

    // A Bluetooth address ("Name (AA:BB:CC:DD:EE:FF)") or a network printer ("192.168.1.50:9100").
    var printerName: String
        get() = prefs.getString("printerName", "") ?: ""
        set(value) { prefs.edit().putString("printerName", value).commit() }

    // How much lighter receipt photos are printed: 0 = as is ... 6 = lightest.
    var printLightness: Int
        get() = prefs.getInt("printLightness", 2)
        set(value) { prefs.edit().putInt("printLightness", value).commit() }

    // Update channel: "canary" (the main kiosk, gets new versions first) or "stable" (the rest).
    var updateChannel: String
        get() = if (prefs.getString("updateChannel", "stable") == "canary") "canary" else "stable"
        set(value) { prefs.edit().putString("updateChannel", if (value == "canary") "canary" else "stable").commit() }

    fun credential(): String = decrypt(prefs.getString(KEY_CREDENTIAL, "") ?: "")

    fun save(kioskId: String, credential: String, packageId: String, mode: String, printerName: String): Boolean =
        prefs.edit()
            .putString("kioskId", kioskId)
            .putString(KEY_CREDENTIAL, encrypt(credential))
            .putString("packageId", packageId)
            .putString("mode", mode)
            .putString("printerName", printerName)
            .commit()

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        if (stored.isEmpty()) return ""
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, GCM_IV_BYTES))
        return String(cipher.doFinal(bytes, GCM_IV_BYTES, bytes.size - GCM_IV_BYTES), Charsets.UTF_8)
    }

    private companion object {
        const val KEY_ALIAS = "photobooth-device-credential"
        const val KEY_CREDENTIAL = "credential"
        const val GCM_IV_BYTES = 12
    }
}
