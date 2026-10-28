package com.memories.photobooth

import java.io.ByteArrayOutputStream
import kotlin.math.pow

// ESC/POS raster printing, the same output as the Windows agent's agent/escpos-raw.cs:
// each copy = photo (Floyd-Steinberg dithered to black/white dots) + paper feed + cut.
object EscPos {
    val RECEIPT_DOTS = mapOf("thermal58" to 384, "thermal80" to 576, "thermal100" to 832)

    // Lightness levels from the admin page: 0 = as the image is ... 6 = lightest. Default 2.
    private val LIGHTNESS = doubleArrayOf(1.0, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35)
    fun gammaOf(level: Int?): Double = LIGHTNESS.getOrNull(level ?: 2) ?: 0.72

    private const val BAND_ROWS = 128   // rows per GS v 0 block (small printer buffers)

    // `gray` is luminance 0..255, row by row, `width` x `height`. Thermal dots bleed into each
    // other, so grey levels are lifted by `gamma` first (1 = as is, lower = lighter mid-tones).
    fun dither(gray: FloatArray, width: Int, height: Int, gamma: Double): BooleanArray {
        if (gamma > 0 && kotlin.math.abs(gamma - 1) > 0.001) {
            val lut = FloatArray(256) { (255 * (it / 255.0).pow(gamma)).toFloat() }
            for (i in gray.indices) gray[i] = lut[gray[i].coerceIn(0f, 255f).toInt()]
        }
        val black = BooleanArray(width * height)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val i = y * width + x
                val old = gray[i]
                val value = if (old < 128) 0f else 255f
                val err = old - value
                black[i] = value == 0f
                if (x + 1 < width) gray[i + 1] += err * 7 / 16
                if (y + 1 < height) {
                    if (x > 0) gray[i + width - 1] += err * 3 / 16
                    gray[i + width] += err * 5 / 16
                    if (x + 1 < width) gray[i + width + 1] += err * 1 / 16
                }
            }
        }
        return black
    }

    // Black/white dots -> ESC/POS blocks for `copies` slips: reset, one block per raster band,
    // then feed + cut. The link may pause between blocks (never inside one) to check delivery.
    fun raster(black: BooleanArray, width: Int, height: Int, copies: Int, cut: Boolean): List<ByteArray> {
        val bytesPerLine = (width + 7) / 8
        val blocks = mutableListOf<ByteArray>()
        repeat(copies) {
            blocks += byteArrayOf(0x1B, 0x40)                                    // ESC @ reset
            var y0 = 0
            while (y0 < height) {
                val rows = minOf(BAND_ROWS, height - y0)
                val band = ByteArrayOutputStream()
                band.write(byteArrayOf(0x1D, 0x76, 0x30, 0x00,
                    (bytesPerLine and 0xFF).toByte(), (bytesPerLine shr 8).toByte(),
                    (rows and 0xFF).toByte(), (rows shr 8).toByte()))
                val data = ByteArray(bytesPerLine * rows)
                for (y in 0 until rows) {
                    for (x in 0 until width) {
                        if (black[(y0 + y) * width + x]) {
                            val at = y * bytesPerLine + (x shr 3)
                            data[at] = (data[at].toInt() or (0x80 shr (x and 7))).toByte()
                        }
                    }
                }
                band.write(withoutRealtimeCommands(data))
                blocks += band.toByteArray()
                y0 += rows
            }
            // feed 4 lines past the cutter, then a partial cut
            blocks += if (cut) byteArrayOf(0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00) else byteArrayOf(0x1B, 0x64, 0x04)
        }
        return blocks
    }

    // Many printers act on DLE EOT / DLE ENQ / DLE DC4 even inside picture data: a photo whose dots
    // happen to spell one makes the printer answer (looks like a delivery receipt) or clear its buffer.
    // Dropping the one dot that starts such a sequence is invisible on paper.
    fun withoutRealtimeCommands(data: ByteArray): ByteArray {
        for (i in 0 until data.size - 1) {
            if (data[i] == DLE && data[i + 1].toInt() in REALTIME_SECOND) data[i] = 0
        }
        return data
    }

    private const val DLE: Byte = 0x10
    private val REALTIME_SECOND = setOf(0x04, 0x05, 0x14)

    // Real-time status requests (DLE EOT n). Printers answer at once, even while busy.
    val STATUS_PRINTER = byteArrayOf(0x10, 0x04, 0x01)
    val STATUS_OFFLINE = byteArrayOf(0x10, 0x04, 0x02)
    val STATUS_PAPER = byteArrayOf(0x10, 0x04, 0x04)

    // Every DLE EOT answer has bit 1 and bit 4 set, bit 0 and bit 7 clear.
    fun isStatusByte(value: Int) = value and 0x93 == 0x12
    fun paperOut(value: Int) = isStatusByte(value) && value and 0x60 == 0x60
    fun coverOpen(value: Int) = isStatusByte(value) && value and 0x04 != 0
}
