// Owner dashboard: sign in with Supabase Auth, read dashboard_overview(), draw it.
// The anon key below is public by design; every number comes from a function that only
// returns kiosks of workspaces the signed-in user belongs to. All text is set with
// textContent, never innerHTML.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zualrdvvlcoexqrbedhl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1YWxyZHZ2bGNvZXhxcmJlZGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTYwMjMsImV4cCI6MjEwMDA5MjAyM30.1JgXhpQccIOxgFgvx_G7cBlnCkSiWQhEihUAd8xCyV8';

const REFRESH_MS = 60_000;
const ONLINE_SEC = 150;   // heartbeat every ~60 s
const SLOW_SEC = 600;

interface Live {
  last_seen: string; started_at: string | null; agent_version: string | null; update_channel: string | null;
  mode: string | null; page: string | null; printer_name: string | null; printer_state: string | null;
  printer_detail: string | null; paper_remaining: number | null; last_error: string | null; last_error_at: string | null;
}
interface Day { day: string; sessions: number; prints: number; copies: number; failed: number; ambiguous: number; orders: number; revenueMinor: number }
interface Kiosk {
  id: string; name: string; status: string; mode: string; live: Live | null; series: Day[];
  open: { ambiguousJobs: number; refundsNeeded: number };
}
interface Job { id: string; kiosk_id: string; status: string; copies: number; created_at: string; finished_at: string | null }
interface Order { id: string; kiosk_id: string; status: string; quota_kind: string; amount_minor: number; created_at: string; paid_at: string | null }
interface Overview { generatedAt: string; days: number; kiosks: Kiosk[]; recentJobs: Job[]; recentOrders: Order[] }

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const app = document.getElementById('app') as HTMLElement;
let timer: number | undefined;

// ---------------------------------------------------------------- tiny DOM helper
type Child = Node | string | null | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value; else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}
const svgNs = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------- formatting
const baht = (minor: number): string => '฿' + (minor / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const time = (iso: string): string => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ago(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 90) return 'เมื่อสักครู่';
  if (sec < 3600) return `${Math.round(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.round(sec / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.round(sec / 86400)} วันที่แล้ว`;
}

type Tone = 'ok' | 'warn' | 'bad' | '';
function connection(live: Live | null): { tone: Tone; label: string } {
  if (!live) return { tone: '', label: 'ยังไม่เคยเชื่อมต่อ' };
  const sec = (Date.now() - Date.parse(live.last_seen)) / 1000;
  if (sec <= ONLINE_SEC) return { tone: 'ok', label: 'ออนไลน์' };
  if (sec <= SLOW_SEC) return { tone: 'warn', label: `ช้า · ${ago(live.last_seen)}` };
  return { tone: 'bad', label: `ขาดการติดต่อ · ${ago(live.last_seen)}` };
}

const PRINTER_STATE: Record<string, [string, Tone]> = {
  ready: ['พร้อม', 'ok'], busy: ['กำลังพิมพ์', 'ok'], offline: ['ออฟไลน์', 'bad'], error: ['ผิดพลาด', 'bad'], unknown: ['ไม่ทราบสถานะ', ''],
};
const PRINTER_DETAIL: Record<string, string> = {
  no_paper: 'กระดาษหมด', low_paper: 'กระดาษใกล้หมด', door_open: 'ฝาเปิด', paper_jam: 'กระดาษติด', no_toner: 'หมึกหมด',
  low_toner: 'หมึกใกล้หมด', offline: '', printing: '', warming_up: 'กำลังอุ่นเครื่อง', printer_not_found: 'ไม่พบเครื่องพิมพ์ใน Windows',
  service_requested: 'ต้องตรวจเครื่อง', status_unknown: '', check_failed: 'ตรวจสถานะไม่ได้',
};
const JOB_STATUS: Record<string, [string, Tone]> = {
  completed: ['สำเร็จ', 'ok'], failed: ['ล้มเหลว', 'bad'], ambiguous: ['ต้องตรวจ', 'warn'], printing: ['กำลังพิมพ์', ''], reserved: ['จองไว้', ''], cancelled: ['ยกเลิก', ''],
};
const ORDER_STATUS: Record<string, [string, Tone]> = {
  paid: ['จ่ายแล้ว', 'ok'], pending: ['รอจ่าย', ''], expired: ['หมดเวลา', ''], cancelled: ['ยกเลิก', ''], failed: ['ล้มเหลว', 'bad'], refund_required: ['ต้องคืนเงิน', 'bad'],
};
const QUOTA: Record<string, string> = { '2': '2 ครั้ง', '5': '5 ครั้ง', unlimited: 'ไม่จำกัด' };

function pill(tone: Tone, label: string): HTMLElement {
  return h('span', { class: `pill ${tone}` }, h('span', { class: 'dot' }), label);
}

// ---------------------------------------------------------------- charts
function sparkline(series: Day[]): SVGElement {
  const width = 300, height = 56, gap = 3;
  const max = Math.max(1, ...series.map((d) => d.sessions));
  const barW = (width - gap * (series.length - 1)) / Math.max(series.length, 1);
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `จำนวนรอบถ่ายรายวัน ${series.length} วัน`);
  series.forEach((d, i) => {
    const barH = d.sessions === 0 ? 2 : Math.max(3, (d.sessions / max) * (height - 4));
    const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('x', String(i * (barW + gap)));
    rect.setAttribute('y', String(height - barH));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(barH));
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', i === series.length - 1 ? 'var(--bar)' : 'var(--bar-dim)');
    const title = document.createElementNS(svgNs, 'title');
    title.textContent = `${d.day}: ${d.sessions} รอบ · พิมพ์ ${d.prints} · ${baht(d.revenueMinor)}`;
    rect.append(title);
    svg.append(rect);
  });
  return svg;
}

// ---------------------------------------------------------------- views
function kioskCard(k: Kiosk): HTMLElement {
  const conn = connection(k.live);
  const today = k.series[k.series.length - 1] ?? { sessions: 0, prints: 0, revenueMinor: 0 } as Day;
  const total = k.series.reduce((sum, d) => sum + d.sessions, 0);
  const live = k.live;

  const rows: Child[] = [];
  const add = (label: string, value: Child) => rows.push(h('dt', {}, label), h('dd', {}, value));

  if (live) {
    const [pLabel, pTone] = PRINTER_STATE[live.printer_state ?? 'unknown'] ?? PRINTER_STATE.unknown;
    const detail = PRINTER_DETAIL[live.printer_detail ?? ''] ?? '';
    add('เครื่องพิมพ์', h('span', { class: pTone }, `${live.printer_name || '—'} · ${pLabel}${detail ? ` (${detail})` : ''}`));
    const paper = live.paper_remaining;
    add('กระดาษที่เหลือ', paper == null ? '—' : h('span', { class: paper <= 5 ? 'bad' : paper <= 20 ? 'warn' : '' }, `${paper.toLocaleString('th-TH')} ใบ`));
    const idle = !live.page || live.page === '/home.html' || live.page === '/';
    add('ตอนนี้', idle ? 'หน้าแรก (ว่าง)' : `มีผู้ใช้งาน (${live.page})`);
    add('เปิดโปรแกรมมาแล้ว', live.started_at ? ago(live.started_at).replace(' ที่แล้ว', '') : '—');
  }

  const issues: Child[] = [];
  if (k.open.ambiguousJobs > 0) issues.push(h('span', { class: 'issue' }, `งานพิมพ์ที่ต้องตรวจ ${k.open.ambiguousJobs}`));
  if (k.open.refundsNeeded > 0) issues.push(h('span', { class: 'issue' }, `ต้องคืนเงิน ${k.open.refundsNeeded}`));

  const version = live?.agent_version ? live.agent_version.split('-')[0] : '';
  return h('article', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, k.name),
        h('div', { class: 'meta' },
          h('span', {}, k.mode === 'event' ? 'โหมดอีเวนต์' : 'โหมดขายแพ็กเกจ'),
          live?.mode && live.mode !== k.mode ? h('span', {}, `ตู้รายงาน: ${live.mode}`) : null,
          version ? h('span', {}, `เวอร์ชัน ${version}`) : null,
          live?.update_channel ? h('span', {}, live.update_channel === 'canary' ? 'เครื่องหลัก' : 'ช่องปกติ') : null)),
      pill(conn.tone, conn.label)),
    rows.length ? h('dl', {}, ...rows) : h('div', { class: 'sub' }, 'ยังไม่มีสัญญาณจากตู้นี้ (ติดตั้งตัวโปรแกรมเวอร์ชันล่าสุดแล้วรอสักครู่)'),
    h('div', { class: 'stats' },
      h('div', {}, h('div', { class: 'n' }, String(today.sessions)), h('div', { class: 'l' }, 'รอบถ่ายวันนี้')),
      h('div', {}, h('div', { class: 'n' }, String(today.prints)), h('div', { class: 'l' }, 'พิมพ์วันนี้')),
      h('div', {}, h('div', { class: 'n' }, baht(today.revenueMinor)), h('div', { class: 'l' }, 'ยอดขายวันนี้'))),
    h('div', {},
      h('div', { class: 'spark-title' }, h('span', {}, `รอบถ่าย ${k.series.length} วันล่าสุด`), h('span', {}, `รวม ${total.toLocaleString('th-TH')}`)),
      sparkline(k.series)),
    issues.length ? h('div', { class: 'issues' }, ...issues) : null,
    live?.last_error ? h('div', { class: 'err' }, `${live.last_error}${live.last_error_at ? ` · ${ago(live.last_error_at)}` : ''}`) : null);
}

function tile(label: string, value: string, alert = false): HTMLElement {
  return h('div', { class: `tile${alert ? ' alert' : ''}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
}

function table(headers: string[], rows: Child[][], numericFrom = -1): HTMLElement {
  if (!rows.length) return h('div', { class: 'table-wrap' }, h('div', { class: 'empty' }, 'ยังไม่มีรายการ'));
  const head = h('tr', {}, ...headers.map((t, i) => h('th', { class: numericFrom >= 0 && i >= numericFrom ? 'num' : '' }, t)));
  const body = rows.map((cells) => h('tr', {}, ...cells.map((c, i) => h('td', { class: numericFrom >= 0 && i >= numericFrom ? 'num' : '' }, c))));
  return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}

function renderDashboard(data: Overview, email: string): void {
  const names = new Map(data.kiosks.map((k) => [k.id, k.name]));
  const online = data.kiosks.filter((k) => connection(k.live).tone === 'ok').length;
  const todays = data.kiosks.map((k) => k.series[k.series.length - 1]).filter(Boolean);
  const sum = (pick: (d: Day) => number) => todays.reduce((acc, d) => acc + pick(d), 0);
  const needsCheck = data.kiosks.reduce((acc, k) => acc + k.open.ambiguousJobs + k.open.refundsNeeded, 0);

  const refresh = h('button', { type: 'button' }, 'รีเฟรช');
  refresh.addEventListener('click', () => { void load(refresh); });
  const signOut = h('button', { type: 'button' }, 'ออกจากระบบ');
  signOut.addEventListener('click', async () => { await client.auth.signOut(); showLogin(); });

  app.replaceChildren(
    h('header', { class: 'top' },
      h('div', {}, h('h1', {}, 'Photobooth · ภาพรวมตู้'), h('div', { class: 'sub' }, `${email} · อัปเดต ${time(data.generatedAt)} · รีเฟรชเองทุก 1 นาที`)),
      h('div', { class: 'actions' }, refresh, signOut)),
    h('div', { class: 'tiles' },
      tile('ตู้ออนไลน์', `${online}/${data.kiosks.length}`, data.kiosks.length > 0 && online < data.kiosks.length),
      tile('รอบถ่ายวันนี้', sum((d) => d.sessions).toLocaleString('th-TH')),
      tile('พิมพ์วันนี้ (ครั้ง)', sum((d) => d.prints).toLocaleString('th-TH')),
      tile('ยอดขายวันนี้', baht(sum((d) => d.revenueMinor))),
      tile('ต้องตรวจ/คืนเงิน', String(needsCheck), needsCheck > 0)),
    data.kiosks.length
      ? h('div', { class: 'grid' }, ...data.kiosks.map(kioskCard))
      : h('div', { class: 'notice' }, 'บัญชีนี้ยังไม่มีตู้ในระบบ หรือยังไม่ได้ถูกเพิ่มเป็นสมาชิกของ workspace'),
    h('section', { class: 'block' }, h('h3', {}, 'งานพิมพ์ล่าสุด'),
      table(['เวลา', 'ตู้', 'สถานะ', 'ใบ'], data.recentJobs.map((j) => {
        const [label, tone] = JOB_STATUS[j.status] ?? [j.status, ''];
        return [time(j.created_at), names.get(j.kiosk_id) ?? '—', pill(tone, label), String(j.copies)];
      }), 3)),
    h('section', { class: 'block' }, h('h3', {}, 'การชำระเงินล่าสุด (PromptPay)'),
      table(['เวลา', 'ตู้', 'แพ็กเกจ', 'สถานะ', 'ยอด'], data.recentOrders.map((o) => {
        const [label, tone] = ORDER_STATUS[o.status] ?? [o.status, ''];
        return [time(o.created_at), names.get(o.kiosk_id) ?? '—', QUOTA[o.quota_kind] ?? o.quota_kind, pill(tone, label), baht(o.amount_minor)];
      }), 4)));
}

function showLogin(message = ''): void {
  window.clearInterval(timer);
  const email = h('input', { type: 'email', autocomplete: 'username', required: '', id: 'email', inputmode: 'email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: '', id: 'password' });
  const button = h('button', { type: 'submit', class: 'primary' }, 'เข้าสู่ระบบ');
  const msg = h('div', { class: 'msg', role: 'alert' }, message);
  const form = h('form', { class: 'login' },
    h('h1', {}, 'Photobooth Dashboard'), h('div', { class: 'sub' }, 'สำหรับเจ้าของเท่านั้น'),
    h('label', { for: 'email' }, 'อีเมล'), email,
    h('label', { for: 'password' }, 'รหัสผ่าน'), password, button, msg);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    msg.textContent = '';
    const { error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    button.disabled = false;
    if (error) {
      // 400 = wrong credentials; anything else is a connection or service problem worth showing.
      msg.textContent = error.status === 400 ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : `เข้าสู่ระบบไม่ได้: ${error.message}`;
      password.value = '';
      return;
    }
    await start();
  });
  app.replaceChildren(form);
  email.focus();
}

async function load(button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  try {
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) { showLogin(); return; }
    const { data, error } = await client.rpc('dashboard_overview', { p_days: 14 });
    if (error) {
      if (/not_authenticated|JWT/i.test(error.message)) { await client.auth.signOut(); showLogin('หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง'); return; }
      throw error;
    }
    renderDashboard(data as Overview, userData.user.email ?? '');
  } catch {
    const banner = h('div', { class: 'notice', role: 'alert' }, 'โหลดข้อมูลไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ');
    app.prepend(banner);
    window.setTimeout(() => banner.remove(), 6000);
  } finally {
    if (button) button.disabled = false;
  }
}

async function start(): Promise<void> {
  await load();
  window.clearInterval(timer);
  timer = window.setInterval(() => { void load(); }, REFRESH_MS);
}

void (async () => {
  const { data } = await client.auth.getSession();
  if (data.session) await start(); else showLogin();
})();
