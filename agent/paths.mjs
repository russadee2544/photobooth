import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
export const DATA_DIR = process.env.PB_AGENT_DATA || join(import.meta.dirname, 'data');
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
export const JOBS_FILE = join(DATA_DIR, 'jobs.json');
export const WEB_ROOT = process.env.PB_AGENT_WEB || join(ROOT, 'dist-next');
