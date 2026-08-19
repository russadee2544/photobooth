# PLAN Review Log

Plan: `PLAN.md`  
Review method: Codex CLI adversarial read-only review  
Maximum rounds: 5

## Pre-review

- ACT 1 interview completed.
- User decisions consolidated into the locked plan.
- No production code has been changed.
- Review pending.

## Rounds

## Round 1 — Codex

1. Baseline ไม่ reproducible เพราะ source มี user changes, untracked migration และ tracked `node_modules`; ให้ inventory/preserve, untrack generated files และสร้าง clean baseline ที่ผูก source/deployed schema revisions
2. แผนยังไม่ reconcile database drift ทั้ง `kiosk_sessions`, `layout_sizes`, `custom_themes` และ Storage bucket; ให้ dump remote schema/policies/functions/buckets ก่อนออกแบบ schema ใหม่
3. Default PIN `1234` ใน migration เดิมอาจรอด; ให้ invalidate, revoke sessions, mark unprovisioned และบังคับ owner-authenticated enrollment
4. การปิด privileged anon RPC ยังไม่ละเอียดพอ; ให้ enumerate overloads, revoke `PUBLIC`/`anon`/`authenticated`, drop obsolete functions และย้าย definer functions ไป private schema พร้อม `search_path=''`
5. Device authentication ยังไม่กำหนด bootstrap, token, rotation, revocation, replay/APK extraction defense
6. Schema ไม่มี ownership cardinality/RLS operation matrix และ cross-owner negative tests
7. Shared 4-digit PIN brute-force ได้ โดยเฉพาะ offline; ต้อง persistent lockout, short-lived capability, จำกัด offline privilege และ owner MFA
8. Monitoring ไม่ชดเชย Redeem entropy ต่ำและ unlimited attempts; ต้อง rate control/circuit breaker หรือเพิ่ม entropy
9. Redeem `active when printed` ขัดกับ physical print ambiguity; ต้อง canonical state machine และ activate ก่อน dispatch
10. Close Event มี admission race; ต้อง atomic `open → closing`, cutoff/lease manifest และรอ terminal states
11. Raw TCP ESC/POS ไม่ exactly-once; ต้อง persist intent และห้าม auto-retry เมื่อ ambiguous
12. เลือก hardware ช้าเกินไป; ต้อง printer/native proof-of-concept ก่อน finalize layout/composition
13. Offline assets ขาด encryption, capacity reservation, admission threshold และ transactional reference counting
14. Retention ไม่กำหนด authoritative clock, delayed upload ordering และ event hard maximum
15. Drive export ตรวจเพียง counts; ต้อง immutable hash manifest, server-side OAuth custody และ idempotent resume
16. Service worker เดิม `skipWaiting/clients.claim` ขัดกับ session-aware update; ต้องแยก Capacitor/native update และ PWA activation gate
17. Observability ไม่มี SLO, alert, correlation, queue/dead-letter policy
18. Phase 2/3 abstractions เร็วเกินไป; implement เฉพาะ contract ที่ Phase 1 ใช้จริง

VERDICT: REVISE

### Plan author's response

- รับข้อ 1–7 และ 9–18; แก้ใน `PLAN.md` โดยเพิ่ม baseline/schema reconciliation, default credential migration, private function boundary, device provisioning protocol, RLS matrix, persistent Admin lockout/MFA, canonical Redeem/Event/Print states, hardware gate, encrypted offline capacity, authoritative retention, Drive hash manifest, update separation และ SLO/dead-letter rules
- ข้อ 8: ไม่เพิ่ม customer-visible cooldown และไม่เปลี่ยน format `AB1234` เพราะเป็น requirement ที่ผู้ใช้ล็อกไว้ แต่เพิ่ม high-threshold global/per-device abuse ceiling, generic response และ anomaly circuit breaker ซึ่งไม่กระทบการกรอกตามปกติ พร้อมคง residual entropy risk ไว้อย่างชัดเจน
- ข้อ 18: ตัดการ implement `PaymentProvider` และ `ImageEffectPipeline` ล่วงหน้า เหลือเพียง ADR/extension seam จน Phase 2/3 requirements ถูกล็อก

## Round 2 — Codex

1. Legacy-data cutover ยังไม่กำหนด disposition ของ voucher เดิม, backup, dry run, invariants, cutover order และ rollback
2. Device token ยังไม่เลือก integration path ว่าเป็น Supabase Auth principal หรือ custom verification ใน Edge Functions
3. Schema ยังไม่มี device keys, bootstrap hashes, revocation, nonces, admin capabilities, lockouts และ outbox
4. เก็บ Android attestation metadata แต่ไม่กำหนด challenge/chain/revocation/security-level verification และ fallback
5. Paid offline override ไม่กำหนดว่าจะ consume code อย่างไร จึงอาจใช้ code ซ้ำก่อน sync
6. Close Event ยังต้องระบุ states, transaction admission rejection, lease expiry และ completion predicate
7. Event retention 30 วันยังไม่ hard เพราะห้ามลบเมื่อ export ไม่สำเร็จ
8. Dedicated Kiosk ยังเป็น UI feature ไม่ใช่ Device Owner/DPC lock-task
9. Raw ESC/POS port 9100 ไม่มี network threat model
10. Frame upload validation ยังไม่ครอบคลุม MIME spoofing, decoded dimensions, decompression bomb, metadata และ malformed PNG
11. บันทึก consent version แต่ flow มีเพียง notice ไม่มี affirmative acknowledgement
12. CSV export เสี่ยง formula injection

VERDICT: REVISE

### Plan author's response

- รับทั้ง 12 ข้อ
- ล็อก Kiosk auth path เป็น custom PoP ผ่าน Edge Functions ที่ `verify_jwt=false`; Kiosk ไม่เป็น Supabase Auth user และไม่มี direct table access ส่วน Owner ยังคงใช้ Supabase Auth + MFA
- เพิ่ม legacy cutover/disposition, security/outbox entities, verified Android attestation พร้อม low-assurance Pilot fallback, offline override entitlement แยกจาก Redeem, Event states/completion predicate, absolute day-30 deletion, DPC lock-task, isolated printer VLAN, sanitized server-side PNG derivative, affirmative Event start acknowledgement และ CSV neutralization

## Round 3 — Failed run (not counted as a verdict)

- Resumed the same reviewer thread `019ff00d-b349-72a1-9343-cad597c3abb3` with `sandbox_mode="read-only"`.
- Reviewer read the revised plan and began checking remaining seams.
- The run exceeded the 10-minute timeout guard and later reported an idle WebSocket timeout before returning a final message.
- Process was terminated; no `VERDICT: APPROVED` or `VERDICT: REVISE` was produced.
- Per the skill safety rule, the run was not retried blindly and no convergence is claimed.

## Round 3 — Codex (successful retry after user request)

1. Cutover freeze เฉพาะ legacy admin writes ทำให้ customer `redeem_use` เปลี่ยนข้อมูลหลัง backfill ได้; ต้อง full maintenance/freeze ทุก mutation หรือ dual-write reconcile
2. Custom auth ที่ `verify_jwt=false` มี unauthenticated DoS surface และ revocation race; ต้อง cheap pre-parse limits และ recheck credential/nonce/idempotency ใน transaction เดียวกับ mutation
3. Offline PIN capability ยังไม่กำหนด secure local verifier หรือ fail-closed behavior เมื่อ server capability หมดอายุ
4. Offline Event authority ไม่ชัดเจนและ IndexedDB/file ไม่ atomic ร่วมกัน; ต้อง native SQLite/WAL authority, write-ahead file transitions และ immutable cutoff reconciliation
5. State vocabulary ขัดกัน: `activating` ถูกข้าม, tests ใช้ `used` แทน `claimed`, และ `ambiguous_needs_admin` ไม่อยู่ใน declared state set

VERDICT: REVISE

### Plan author's response

- รับทั้ง 5 ข้อ
- เปลี่ยน cutover เป็น full kiosk maintenance/freeze ทุก legacy mutation พร้อม dual-write bridge เป็น fallback
- เพิ่ม pre-parse request controls และ transaction-time credential/revocation/nonce/idempotency recheck
- เลือก native Keystore-backed offline PIN verifier, encrypted SQLite persistent lockout และ device-signed quota-bound capability; fail closed เมื่อ integrity ไม่ผ่าน
- ล็อก Android offline authority เป็น encrypted SQLite/WAL + content-addressed encrypted files และ immutable Event cutoff sync
- เพิ่ม canonical machine-readable transition tables และใช้ชื่อเดียวกันใน database, TypeScript และ tests

## Round 4 — Codex

Codex ยืนยันว่าข้อค้นพบทั้ง 5 ข้อจาก Round 3 ได้รับการแก้ครบ:

- Cutover หยุด mutation ทุกชนิดและมี dual-write fallback
- Custom authentication มี pre-auth limits และ transactional revocation checks
- Offline PIN verification อยู่ใน native layer, persist lockout, scope ชัดเจน และ fail closed
- SQLite/WAL เป็น authority ของ offline state พร้อม atomic recovery
- Canonical state machines ทำให้ database, TypeScript และ tests ใช้คำศัพท์เดียวกัน

ไม่พบ implementation risk ใหม่ที่มีนัยสำคัญ ความเสี่ยงเรื่อง hardware, short-code entropy, shared-PIN attribution และ printer acknowledgement ถูกระบุและมี gate/mitigation เหมาะสมแล้ว ผู้ตรวจไม่ได้แก้ไฟล์ใด

VERDICT: APPROVED

## Resolution

- Converged after 4 successful review rounds; one earlier Round 3 attempt timed out and was not counted as a verdict
- Final plan remains implementation-locked until explicit owner sign-off
- No production code was changed during Act 1 or Act 2
