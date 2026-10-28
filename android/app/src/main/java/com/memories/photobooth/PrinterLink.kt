package com.memories.photobooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

// Raw bytes to a receipt printer over Bluetooth (classic SPP, paired in Android settings) or a
// network printer (raw TCP, usually port 9100). Jobs never overlap: one printer, one job at a time.
class PrinterLink(private val context: Context) {

    sealed class Result {
        object Sent : Result()
        // Provably nothing reached the printer: safe to report `failed`.
        data class NotSent(val reason: String) : Result()
        // Some bytes may have printed: the outcome is ambiguous.
        data class Partial(val reason: String) : Result()
    }

    // What the owner dashboard shows; updated after every job.
    @Volatile var state = "unknown"
        private set
    @Volatile var detail = ""
        private set

    private val lock = Any()

    private interface Connection : Closeable {
        val input: InputStream
        val output: OutputStream
    }

    fun list(saved: String): JSONObject {
        val printers = JSONArray()
        var error: String? = null
        try {
            for (device in bondedDevices()) {
                printers.put(obj("name" to device.first, "isDefault" to (device.first == saved), "port" to "Bluetooth", "driver" to "ESC/POS"))
            }
        } catch (e: Unavailable) {
            error = e.reason
        }
        if (saved.isNotEmpty() && parse(saved) is Target.Tcp) {
            printers.put(obj("name" to saved, "isDefault" to true, "port" to "TCP", "driver" to "ESC/POS"))
        }
        val first = printers.optJSONObject(0)?.optString("name") ?: ""
        return obj("printers" to printers, "defaultPrinter" to saved.ifEmpty { first }, "error" to error)
    }

    // Sends the ESC/POS `blocks` (EscPos.raster) to the printer named `name`
    // ("Name (AA:BB:CC:DD:EE:FF)" or "host:port").
    fun send(name: String, payload: List<ByteArray>): Result = synchronized(lock) {
        val result = try {
            sendLocked(resolve(name), payload)
        } catch (e: Unavailable) {
            Result.NotSent(e.reason)
        } catch (e: SecurityException) {
            Result.NotSent("bluetooth_permission")
        }
        when (result) {
            Result.Sent -> { state = "ready"; detail = "" }
            is Result.NotSent -> {
                state = if (result.reason == "no_paper" || result.reason == "cover_open") "error" else "offline"
                detail = result.reason
            }
            is Result.Partial -> { state = "error"; detail = result.reason }
        }
        result
    }

    private fun sendLocked(target: Target, blocks: List<ByteArray>): Result {
        val connection = open(target)
        try {
            var answersStatus = false
            try {
                val paper = query(connection, EscPos.STATUS_PAPER, 800)
                answersStatus = paper != null && EscPos.isStatusByte(paper)
                if (paper != null && EscPos.paperOut(paper)) return Result.NotSent("no_paper")
                if (answersStatus) {
                    val offline = query(connection, EscPos.STATUS_OFFLINE, 800)
                    if (offline != null && EscPos.coverOpen(offline)) return Result.NotSent("cover_open")
                }
            } catch (e: IOException) {
                return Result.NotSent("printer_unreachable")
            }

            // Android accepts the whole job at once and sends it over the air later; closing the link
            // before then cuts the slip short and loses the cut command at the end. So the job goes
            // out in steps: after every ~16 KB the printer must confirm it has received everything
            // so far (a status answer comes back only after the bytes sent before the question).
            // A printer that never answers gets the bytes no faster than Bluetooth can carry them.
            var written = 0
            var sinceCheck = 0
            val started = SystemClock.uptimeMillis()
            try {
                for (block in blocks) {
                    var offset = 0
                    while (offset < block.size) {
                        val n = minOf(CHUNK_BYTES, block.size - offset)
                        connection.output.write(block, offset, n)
                        offset += n
                        written += n
                    }
                    sinceCheck += block.size
                    if (sinceCheck >= CHECK_EVERY_BYTES) {
                        connection.output.flush()
                        answersStatus = delivered(connection, answersStatus, written, started)
                        sinceCheck = 0
                    }
                }
                connection.output.flush()
                if (delivered(connection, answersStatus, written, started)) {
                    SystemClock.sleep(300)
                } else {
                    // No confirmation: let the last unconfirmed bytes go out before closing.
                    SystemClock.sleep(1_000L + CHECK_EVERY_BYTES * 1000L / PACE_BYTES_PER_SECOND)
                }
            } catch (e: IOException) {
                return if (written == 0) Result.NotSent("printer_unreachable") else Result.Partial("connection_lost")
            }
            return Result.Sent
        } finally {
            runCatching { connection.close() }
        }
    }

    // True when the printer confirmed receiving everything written so far. Without status answers
    // (or once they stop), waits until `written` bytes could have crossed at PACE_BYTES_PER_SECOND.
    private fun delivered(connection: Connection, answersStatus: Boolean, written: Int, started: Long): Boolean {
        if (answersStatus && query(connection, EscPos.STATUS_PRINTER, CONFIRM_TIMEOUT_MS) != null) return true
        val due = started + written * 1000L / PACE_BYTES_PER_SECOND
        val now = SystemClock.uptimeMillis()
        if (due > now) SystemClock.sleep(due - now)
        return false
    }

    private fun query(connection: Connection, command: ByteArray, timeoutMs: Long): Int? {
        while (connection.input.available() > 0) connection.input.read()   // stale bytes
        connection.output.write(command)
        connection.output.flush()
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (connection.input.available() > 0) return connection.input.read()
            SystemClock.sleep(20)
        }
        return null
    }

    // ---- targets -------------------------------------------------------------------------

    private sealed class Target {
        data class Bluetooth(val address: String) : Target()
        data class Tcp(val host: String, val port: Int) : Target()
    }

    private class Unavailable(val reason: String) : Exception(reason)

    private fun parse(name: String): Target? {
        MAC.find(name)?.let { return Target.Bluetooth(it.value.uppercase()) }
        TCP.matchEntire(name.trim())?.let { m ->
            val port = m.groupValues[2].toInt()
            if (port in 1..65535) return Target.Tcp(m.groupValues[1], port)
        }
        return null
    }

    // No printer chosen yet: use the only paired printer, if there is exactly one.
    private fun resolve(name: String): Target {
        parse(name)?.let { return it }
        if (name.isNotBlank()) throw Unavailable("printer_not_found")
        val printers = bondedDevices().filter { it.second }
        if (printers.size == 1) return parse(printers[0].first)!!
        throw Unavailable("printer_not_set")
    }

    private fun open(target: Target): Connection = when (target) {
        is Target.Bluetooth -> openBluetooth(target.address)
        is Target.Tcp -> openTcp(target)
    }

    @SuppressLint("MissingPermission")
    private fun adapter() = run {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: throw Unavailable("bluetooth_unavailable")
        if (Build.VERSION.SDK_INT >= 31 &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw Unavailable("bluetooth_permission")
        }
        if (!adapter.isEnabled) throw Unavailable("bluetooth_off")
        adapter
    }

    // Paired devices as ("Name (AA:BB:..)", looksLikePrinter), printers first.
    @SuppressLint("MissingPermission")
    private fun bondedDevices(): List<Pair<String, Boolean>> =
        adapter().bondedDevices.orEmpty().map { device ->
            val label = (device.name ?: "Bluetooth").replace(Regex("[()]"), "")
            val printer = device.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING ||
                PRINTER_NAME.containsMatchIn(device.name ?: "")
            "$label (${device.address})" to printer
        }.sortedBy { !it.second }

    @SuppressLint("MissingPermission")
    private fun openBluetooth(address: String): Connection {
        val device = adapter().getRemoteDevice(address)
        // Some cheap printers only accept the insecure socket; try both before giving up.
        for (attempt in 0 until 3) {
            val socket = if (attempt == 1) device.createInsecureRfcommSocketToServiceRecord(SPP)
            else device.createRfcommSocketToServiceRecord(SPP)
            try {
                socket.connect()
                return object : Connection {
                    override val input: InputStream = socket.inputStream
                    override val output: OutputStream = socket.outputStream
                    override fun close() = socket.close()
                }
            } catch (e: IOException) {
                runCatching { socket.close() }
                SystemClock.sleep(500)
            }
        }
        throw Unavailable("printer_unreachable")
    }

    private fun openTcp(target: Target.Tcp): Connection {
        val socket = Socket()
        try {
            socket.connect(InetSocketAddress(target.host, target.port), 5_000)
        } catch (e: IOException) {
            runCatching { socket.close() }
            throw Unavailable("printer_unreachable")
        }
        return object : Connection {
            override val input: InputStream = socket.getInputStream()
            override val output: OutputStream = socket.getOutputStream()
            override fun close() = socket.close()
        }
    }

    private companion object {
        val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        val MAC = Regex("([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}")
        val TCP = Regex("^(?:tcp://)?([A-Za-z0-9.-]+):(\\d{1,5})$")
        val PRINTER_NAME = Regex("print|pos|pt-?\\d|mtp|rpp|xp-|tp-?\\d|58|80", RegexOption.IGNORE_CASE)
        const val CHUNK_BYTES = 1024
        // How much may be in flight before the printer must confirm it (about 2 raster bands).
        const val CHECK_EVERY_BYTES = 16 * 1024
        const val CONFIRM_TIMEOUT_MS = 10_000L
        // Printers that never answer status: a speed slow Bluetooth printers still keep up with.
        const val PACE_BYTES_PER_SECOND = 8 * 1024
    }
}
