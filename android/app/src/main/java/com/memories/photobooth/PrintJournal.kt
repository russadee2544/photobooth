package com.memories.photobooth

import org.json.JSONObject
import java.io.File
import java.time.Instant

// Durable print-job journal (port of agent/jobs.mjs). A job is written as `printing` BEFORE the
// printer is touched so a crash/restart can never re-send it; unreported results are retried.
class PrintJournal(private val file: File) {
    private var jobs = JSONObject()

    @Synchronized
    fun load() {
        jobs = runCatching { JSONObject(file.readText()) }.getOrDefault(JSONObject())
        // Anything still `printing` after a restart has an unknown outcome.
        for (id in jobs.keys()) {
            val job = jobs.optJSONObject(id) ?: continue
            if (job.optString("state") == "printing") job.put("state", "ambiguous").put("unreported", "ambiguous")
        }
        save()
    }

    @Synchronized
    fun get(id: String): JSONObject? = jobs.optJSONObject(id)?.let { JSONObject(it.toString()) }

    // Merges `patch` into the job; a JSONObject.NULL value clears that field.
    @Synchronized
    fun set(id: String, vararg patch: Pair<String, Any?>): JSONObject {
        val job = jobs.optJSONObject(id) ?: JSONObject()
        for ((key, value) in patch) {
            if (value == null || value == JSONObject.NULL) job.remove(key) else job.put(key, value)
        }
        job.put("updatedAt", Instant.now().toString())
        jobs.put(id, job)
        save()
        return JSONObject(job.toString())
    }

    @Synchronized
    fun unreported(): List<Pair<String, String>> = jobs.keys().asSequence()
        .mapNotNull { id -> jobs.optJSONObject(id)?.optString("unreported")?.takeIf { it.isNotEmpty() }?.let { id to it } }
        .toList()

    private fun save() {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(jobs.toString())
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
