// Durable print-job journal. A job is written as `printing` BEFORE the printer is
// touched so a crash/restart can never re-send it; unreported results are retried.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createJournal(file) {
  let jobs = {};
  let writing = Promise.resolve();

  function save() {
    writing = writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(jobs, null, 2));
      await rename(`${file}.tmp`, file);
    });
    return writing;
  }

  async function load() {
    try { jobs = JSON.parse(await readFile(file, 'utf8')); } catch { jobs = {}; }
    // Anything still `printing` after a restart has an unknown outcome.
    for (const job of Object.values(jobs)) {
      if (job.state === 'printing') { job.state = 'ambiguous'; job.unreported = 'ambiguous'; }
    }
    await save();
  }

  return {
    load,
    get: (id) => jobs[id],
    async set(id, patch) {
      jobs[id] = { ...jobs[id], ...patch, updatedAt: new Date().toISOString() };
      await save();
      return jobs[id];
    },
    unreported: () => Object.entries(jobs).filter(([, job]) => job.unreported),
  };
}
