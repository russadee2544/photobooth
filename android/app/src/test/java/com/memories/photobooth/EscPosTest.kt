package com.memories.photobooth

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EscPosTest {
    @Test fun blackAndWhiteStayAsTheyAre() {
        val gray = floatArrayOf(0f, 255f, 0f, 255f)
        assertArrayEquals(booleanArrayOf(true, false, true, false), EscPos.dither(gray, 4, 1, 0.72))
    }

    @Test fun midGreyBecomesAboutHalfTheDots() {
        val size = 64
        val dots = EscPos.dither(FloatArray(size * size) { 128f }, size, size, 1.0)
        val black = dots.count { it }.toDouble() / dots.size
        assertTrue("black share $black", black in 0.45..0.55)
    }

    @Test fun lighterSettingPrintsFewerDots() {
        val size = 64
        val asIs = EscPos.dither(FloatArray(size * size) { 100f }, size, size, EscPos.gammaOf(0)).count { it }
        val light = EscPos.dither(FloatArray(size * size) { 100f }, size, size, EscPos.gammaOf(4)).count { it }
        assertTrue(light < asIs)
    }

    // Same bytes as agent/escpos-raw.cs: reset, GS v 0 raster, feed, partial cut, per copy.
    @Test fun rasterMatchesTheWindowsAgent() {
        val black = BooleanArray(10 * 2).also { it[0] = true; it[9] = true; it[10 + 1] = true }
        val bytes = EscPos.raster(black, 10, 2, 2, true).reduce { all, block -> all + block }
        val one = byteArrayOf(0x1B, 0x40, 0x1D, 0x76, 0x30, 0x00, 2, 0, 2, 0,
            0x80.toByte(), 0x40, 0x40, 0x00,
            0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00)
        assertArrayEquals(one + one, bytes)
    }

    @Test fun tallImagesAreSentInBands() {
        val blocks = EscPos.raster(BooleanArray(8 * 300), 8, 300, 1, false)
        // reset, 3 bands (128 + 128 + 44 rows, each an 8-byte header + 1 byte per row), feed.
        assertEquals(listOf(2, 8 + 128, 8 + 128, 8 + 44, 3), blocks.map { it.size })
    }

    // A photo whose dots spell DLE EOT would make the printer answer mid-picture.
    @Test fun pictureDataNeverSpellsARealtimeCommand() {
        val data = byteArrayOf(0x10, 0x04, 0x10, 0x05, 0x10, 0x14, 0x10, 0x20, 0x7F, 0x10)
        assertArrayEquals(byteArrayOf(0, 0x04, 0, 0x05, 0, 0x14, 0x10, 0x20, 0x7F, 0x10), EscPos.withoutRealtimeCommands(data))
    }

    @Test fun readsStatusAnswers() {
        assertTrue(EscPos.paperOut(0x72))
        assertFalse(EscPos.paperOut(0x12))
        assertTrue(EscPos.coverOpen(0x16))
        assertFalse(EscPos.paperOut(0xFF))   // not a status byte
    }
}
