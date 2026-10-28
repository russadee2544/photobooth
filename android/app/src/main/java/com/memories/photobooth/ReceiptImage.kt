package com.memories.photobooth

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import kotlin.math.max
import kotlin.math.roundToInt

// PNG/JPEG bytes -> ESC/POS blocks (EscPos.raster), scaled to the paper's dot width.
object ReceiptImage {
    fun build(image: ByteArray, dots: Int, copies: Int, cut: Boolean, gamma: Double): List<ByteArray> {
        val (gray, height) = grayscale(image, dots)
        return EscPos.raster(EscPos.dither(gray, dots, height, gamma), dots, height, copies, cut)
    }

    // Several images in one job, one after another, each one cut off (e.g. redeem code slips).
    fun buildMany(images: List<ByteArray>, dots: Int, cut: Boolean, gamma: Double): List<ByteArray> =
        images.flatMap { build(it, dots, 1, cut, gamma) }

    private fun grayscale(image: ByteArray, width: Int): Pair<FloatArray, Int> {
        val source = BitmapFactory.decodeByteArray(image, 0, image.size) ?: throw IllegalArgumentException("invalid_image")
        val height = max(1, (source.height * width.toDouble() / source.width).roundToInt())
        // Halve first while far too large, so the final filtered scale samples every pixel.
        var step = source
        while (step.width >= width * 2 && step.height >= 2) {
            val next = Bitmap.createScaledBitmap(step, step.width / 2, max(1, step.height / 2), true)
            if (step !== source) step.recycle()
            step = next
        }
        val scaled = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(scaled).apply {
            drawColor(Color.WHITE)   // transparent parts print as paper
            drawBitmap(step, null, Rect(0, 0, width, height), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        }
        if (step !== source) step.recycle()
        source.recycle()
        val pixels = IntArray(width * height)
        scaled.getPixels(pixels, 0, width, 0, 0, width, height)
        scaled.recycle()
        val gray = FloatArray(pixels.size) {
            val p = pixels[it]
            Color.red(p) * 0.299f + Color.green(p) * 0.587f + Color.blue(p) * 0.114f
        }
        return gray to height
    }
}
