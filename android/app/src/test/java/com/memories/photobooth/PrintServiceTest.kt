package com.memories.photobooth

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Base64

// Same rules as agent/print-pass.test.mjs (the Windows agent).
class PrintServiceTest {
    @get:Rule val folder = TemporaryFolder()

    private val job = "11111111-1111-4111-8111-111111111111"
    private val token = "a".repeat(64)
    private val dataUrl = "data:image/png;base64," + Base64.getEncoder().encodeToString("fake-png".toByteArray())

    private lateinit var journal: PrintJournal
    private val starts = mutableListOf<String>()
    private val reports = mutableListOf<String>()
    private var prints = 0
    private var startReply: () -> JSONObject = { obj("jobId" to job, "status" to "printing", "copies" to 2, "assetSha256" to PrintService.sha256Hex(dataUrl)) }
    private val reportReplies = ArrayDeque<JSONObject>()
    private var printImage: () -> Unit = {}

    @Before fun setUp() {
        journal = PrintJournal(File(folder.root, "jobs.json")).apply { load() }
    }

    private fun service() = PrintService(object : PrintService.Server {
        override fun startPrint(jobId: String, sessionToken: String): JSONObject { starts += jobId; return startReply() }
        override fun reportPrint(jobId: String, result: String): JSONObject {
            reports += result
            return reportReplies.removeFirstOrNull() ?: obj("jobId" to jobId, "status" to result, "remaining" to 3)
        }
    }, journal) { _, _, _, _ -> prints++; printImage() }

    private fun args(copies: Int = 2, url: String = dataUrl) =
        obj("sessionToken" to token, "jobId" to job, "dataUrl" to url, "copies" to copies)

    @Test fun printsOnceAndReportsCompleted() {
        val result = service().printAuthorizedPass(args(), "")
        assertEquals("completed", result.getString("status"))
        assertEquals(3, result.getInt("remaining"))
        assertEquals(2, result.getInt("copiesCompleted"))
        assertEquals(1, prints)
        assertEquals(listOf("completed"), reports)
    }

    @Test fun neverResendsAPrintedJob() {
        val service = service()
        service.printAuthorizedPass(args(), "")
        assertEquals("completed", service.printAuthorizedPass(args(), "").getString("status"))
        assertEquals(1, prints)
        assertEquals(1, starts.size)
    }

    @Test fun rejectsAnImageThatDiffersFromTheReservation() {
        startReply = { obj("status" to "printing", "copies" to 2, "assetSha256" to "f".repeat(64)) }
        assertEquals("failed", service().printAuthorizedPass(args(), "").getString("status"))
        assertEquals(0, prints)
        assertEquals(listOf("failed"), reports)
    }

    @Test fun usesTheServerCopyCount() {
        assertEquals("failed", service().printAuthorizedPass(args(copies = 9), "").getString("status"))
        assertEquals(0, prints)
    }

    @Test fun reportsFailedOnlyWhenNothingWasPrinted() {
        printImage = { throw PrintService.PrintFailure(true, "bluetooth_off") }
        assertEquals("failed", service().printAuthorizedPass(args(), "").getString("status"))
        assertEquals(listOf("failed"), reports)
    }

    @Test fun reportsAmbiguousOnABrokenLinkAndDoesNotResend() {
        printImage = { throw PrintService.PrintFailure(false, "connection_lost") }
        val service = service()
        assertEquals("ambiguous", service.printAuthorizedPass(args(), "").getString("status"))
        assertEquals(listOf("ambiguous"), reports)
        assertEquals("ambiguous", service.printAuthorizedPass(args(), "").getString("status"))
        assertEquals(1, prints)
    }

    @Test fun keepsTheResultForRetryWhenTheServerIsUnreachable() {
        reportReplies += obj("error" to "network_error")
        reportReplies += obj("jobId" to job, "status" to "completed", "remaining" to 1)
        val service = service()
        assertEquals("ambiguous", service.printAuthorizedPass(args(), "").getString("status"))
        assertEquals("completed", journal.get(job)!!.getString("unreported"))
        service.flushUnreported()
        val saved = journal.get(job)!!
        assertEquals("completed", saved.getString("state"))
        assertEquals(1, saved.getInt("remaining"))
        assertNull(saved.opt("unreported"))
    }

    @Test fun doesNotPrintWhenStartIsRefused() {
        startReply = { obj("error" to "print_not_authorized") }
        assertEquals("failed", service().printAuthorizedPass(args(), "").getString("status"))
        assertEquals(0, prints)
    }

    @Test fun rejectsNonImageDataUrls() {
        assertEquals("failed", service().printAuthorizedPass(args(url = "data:text/html;base64,AAAA"), "").getString("status"))
    }

    @Test fun aJobCaughtMidPrintByARestartIsAmbiguous() {
        journal.set(job, "state" to "printing")
        val reopened = PrintJournal(File(folder.root, "jobs.json")).apply { load() }
        assertEquals("ambiguous", reopened.get(job)!!.getString("state"))
        assertEquals(listOf(job to "ambiguous"), reopened.unreported())
    }
}
