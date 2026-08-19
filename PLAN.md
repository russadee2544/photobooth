# Photobooth System — Locked Development Plan

สถานะ: `VERDICT: APPROVED` หลัง adversarial review รอบ 4; รอการอนุมัติสุดท้ายจากเจ้าของระบบก่อนเริ่มแก้โค้ด  
วันที่: 2026-08-11  
ซอร์สที่วิเคราะห์: `C:\ED TECH\photobooth`  
Workspace สำหรับเอกสารแผน: `C:\ED  TECH\photobooth`

## 1. เป้าหมาย

ปรับระบบเดิมให้เป็นแพลตฟอร์มตู้ถ่ายภาพที่ตู้หนึ่งสลับโหมดได้โดย Admin รองรับ Receipt Booth เป็นสินค้าหลักใน Phase 1, Event Mode, Redeem Code, Android Tablet ที่พิมพ์ตรงผ่าน LAN โดยไม่ต้องมี Print Hub และวางโครงสร้างให้เพิ่ม Dynamic QR Payment, Canon SELPHY Photo Booth และความสามารถ Phase 3 ได้โดยไม่ต้องรื้อระบบอีกครั้ง

หลักสำคัญ:

- ลูกค้าไม่เลือกชนิด Booth หรือ Package เอง; Admin ตั้งค่าประจำตู้/งานก่อนเปิดใช้งาน
- Session ที่เริ่มแล้วต้องตรึง Config, Package, Layout และ Frame Version ตลอด Session
- รูปดิบและรูปที่ลูกค้าถ่ายทิ้งไม่ถูกส่งขึ้น Cloud
- การใช้สิทธิ์ การพิมพ์ซ้ำ การออกสิทธิ์ทดแทน การ Override และการเปลี่ยนค่าความปลอดภัยต้องตรวจสอบย้อนหลังได้
- งานพิมพ์ต้องเป็น idempotent เพื่อไม่ให้พิมพ์ซ้ำเกินจำนวนเมื่อเครือข่ายหรือแอปขัดข้อง

## 2. สภาพระบบเดิมและเหตุผลที่ต้อง Refactor

ระบบปัจจุบันเป็น Vite แบบ multi-page ใช้ HTML/JavaScript/Tailwind และมี logic ส่วนกลางจำนวนมากใน `public/shared.js` กับ `admin.html` ขั้นตอนใช้งานหลักมี Home, Layout, Capture, Retake, Template, Filter, Processing, Payment, Print และ Admin ส่วน Supabase มี migration เริ่มต้นสำหรับ Redeem/Admin PIN เท่านั้น

ข้อจำกัดที่ต้องแก้ใน Refactor:

- State กระจายตามหน้าและ browser storage ทำให้กู้สถานะ/ล้างข้อมูลยาก
- ยังไม่มี schema ครบสำหรับ Kiosk, Event, Session, Print Job, Audit, Template Version และ Retention
- RPC เดิมเปิดบางคำสั่ง Admin ให้ `anon` และใช้ shared secret จาก client ซึ่งไม่เหมาะกับ Production
- การพิมพ์ยังไม่มี hardware adapter, acknowledgement และ idempotent retry ที่เชื่อถือได้
- Offline behavior, queue, cleanup และ event export ยังไม่เป็น state machine ที่ตรวจสอบได้
- PIN/session storage และการล้างรูป local ยังมีช่องว่าง
- ไฟล์ต้นแบบหมายเลข `02_...` ถึง `13_...` เป็น design reference ไม่ใช่ runtime หลัก

Refactor จะใช้หน้าตา MEMORIES และ minimal UX เดิมเป็นแนวทาง แต่ไม่ยึดโครงสร้างโค้ดหรือคัดหน้าเดิมแบบ pixel-perfect

## 3. ขอบเขตที่ล็อกแล้ว

### Phase 1 — Receipt Booth

- โหมดประจำตู้ที่ Admin เลือก:
  - `event_free`
  - `paid_redeem`
- Receipt Booth ราคาเริ่มต้น 10 บาทต่อ 1 set
- 1 set คือผลงานเดียวกันจำนวน 2 ใบ พิมพ์และตัดแยกกัน
- Thermal 80mm, ESC/POS, Auto Cutter, USB/LAN
- Reference Hardware: Android Tablet + กล้องในตัว + LAN printer
- Windows Mini PC รองรับเป็นแพลตฟอร์มรอง แต่ไม่เป็น launch blocker
- Local Admin UI; ยังไม่มี Remote Dashboard เต็มรูปแบบ
- ภาษาไทยและอังกฤษ
- Event export ไป Google Drive/บริการที่กำหนดหลัง Admin ปิดงาน
- Customer download เฉพาะ final framed color และ dithered print-equivalent

### Phase 2A — Paid Self-service

- Dynamic PromptPay QR ผ่าน Payment Gateway adapter
- รอ webhook ที่ตรวจสอบลายเซ็นและยืนยันยอดจาก Server เท่านั้น
- Redeem Code ยังคงเป็น fallback

### Phase 2B — Photo Booth

- Canon SELPHY CP1500
- ราคาเริ่มต้น 50 บาทต่อ set
- 1 แผ่น 4×6 มีภาพ 2×6 เหมือนกันสองแถบสำหรับตัด
- Package อื่นเพิ่มผ่าน data/config ได้ภายหลัง

### Phase 3

- Beauty/AR/Stickers
- Remote Dashboard
- บัญชีพนักงานรายบุคคล
- ภาษามลายูและอาหรับ พร้อม RTL
- iPad และ hardware adapter เพิ่มเติมเมื่อผ่านการทดสอบ

## 4. Customer Flow

### 4.1 Paid Redeem

1. หน้าเริ่มแสดง Package ที่ Admin ตั้งไว้ แต่ลูกค้าเปลี่ยนไม่ได้
2. ลูกค้ากรอก Redeem Code รูปแบบ `AB1234`
3. Server ตรวจว่า code เป็น `active`, ไม่หมดอายุ, ไม่เคยใช้, ตรง kiosk และตรง package snapshot
4. ใช้ transaction เดียวเพื่อ claim code และสร้าง authorized session ป้องกัน double use
5. ลูกค้าเลือก Layout จากรายการที่ Admin เปิด
6. ถ่ายภาพตามจำนวน slot; ถ่ายใหม่ได้ไม่จำกัด
7. ลูกค้าเลือก Frame และ Filter ที่ Admin เปิดในหน้าเดียวกัน
8. แสดง final color preview; ลูกค้ากด “ยืนยันและพิมพ์” ครั้งเดียว
9. ระบบ freeze composition, สร้าง final color และ dithered raster แล้วสร้าง print job จำนวน 2 copies
10. Android native print bridge พิมพ์อัตโนมัติ แสดง `1/2` และ `2/2`
11. แสดง QR สำหรับดาวน์โหลดไฟล์ final color และ dithered
12. เมื่อ timeout หรือจบ Session ให้ล้างรูปและ canvas ชั่วคราวจากเครื่อง

ไม่มีหน้าตัวอย่าง Dithered แยกก่อนยืนยัน และลูกค้าเพิ่มจำนวนพิมพ์เองไม่ได้

### 4.2 Event Mode

1. หน้าเริ่มแสดง Event notice เวอร์ชันปัจจุบัน; ปุ่ม “เริ่มใช้งาน” เป็น affirmative acknowledgement ก่อนเปิดกล้อง และมีปุ่มยกเลิกที่ไม่สร้างภาพ/อัปโหลดข้อมูล
2. หลังยืนยัน ข้าม Redeem/Payment และเข้าสู่การเลือก Layout ทันที
3. Admin กำหนด allowed layouts, filters และ frames; branding ถูกล็อกเป็นค่าเริ่มต้นของ Event
4. Flow ถ่าย/เลือกกรอบ/ยืนยันเหมือน Receipt Booth
5. Event ทำงาน offline ได้และเก็บงาน export ใน local durable queue
6. เมื่อ Admin กด `Close Event` ใช้ transaction เปลี่ยน `open → closing`, บันทึก cutoff และชุด session lease ที่รับเข้าก่อน cutoff:
   - การ admit Session ใหม่ต้องตรวจ event state ใน transaction เดียวกัน จึงไม่มี session หลุดระหว่างปิดงาน
   - ปล่อยเฉพาะ Session ใน lease ที่ active ให้จบหรือเข้าสู่ terminal state
   - lease มี heartbeat/expiry; session ที่หมด lease ถูกปิดเป็น `abandoned` หลัง cleanup
   - upload final color และ dithered ที่ค้าง
   - retry จนสำเร็จ
   - สร้าง immutable export manifest จาก asset ID, byte size และ SHA-256 แล้วตรวจ destination object รายไฟล์ ไม่ตรวจเพียงจำนวน
   - ส่ง/แชร์ Google Drive folder ไปยังอีเมลเจ้าของงาน
   - state machine คือ `open → closing → exporting → verified → closed`; failure เป็น `export_failed` และ resume ได้
   - completion predicate: admitted session ทุกตัว terminal, outbox ไม่มีงาน runnable/dead-letter ที่ยังไม่ resolve, manifest ทุกแถว verified และ share สำเร็จ
7. ไม่ส่ง raw photos หรือภาพ retake ที่ถูกทิ้ง

ข้อความแจ้งผู้ใช้ Event: “Event Mode อาจส่งภาพให้เจ้าของงานตามเงื่อนไขของ Event” พร้อมฉบับภาษาอังกฤษ

### 4.3 Inactivity และการยกเลิก

- ไม่มี hard limit ของเวลาถ่ายรวม
- ไม่มีการใช้งาน 2 นาที: แสดงคำเตือน 30 วินาที
- หากไม่ตอบสนอง: ยกเลิก Session และล้างรูป local
- Paid session ที่เสียสิทธิ์จากความขัดข้องไม่มี customer self-recovery ใน Phase 1; Admin ออก replacement entitlement ได้จาก Audit context

## 5. Package, Layout, Frame และ Filter

### 5.1 Package

- Admin ตั้ง booth type, operating mode, package และราคา ก่อนเปิด Kiosk
- Config change มีผลเฉพาะ Session ใหม่
- Redeem บันทึก package/price snapshot ตอนสร้างและใช้กับ kiosk/package อื่นไม่ได้

### 5.2 Layout Presets สำหรับ Receipt Booth

- Classic 3: ภาพ landscape 4:3 จำนวน 3 ภาพเรียงลงมา
- Classic 4: ภาพ landscape 4:3 จำนวน 4 ภาพเรียงลงมา
- Duo: ภาพ 4:3 จำนวน 2 ภาพ
- Portrait: ภาพ portrait 3:4 จำนวน 1 ภาพใหญ่
- Grid 4: ภาพ square 1:1 จำนวน 4 ภาพแบบ 2×2
- 16:9 และ arbitrary layout อยู่นอก Phase 1

Canvas มี width 576 dots สำหรับพื้นที่พิมพ์ประมาณ 72mm ที่ 203dpi ความยาวเป็น preset แยกตาม Layout และ Admin แก้ arbitrary length ไม่ได้ ค่าความยาวจริงต้องปรับเทียบกับเครื่องพิมพ์ที่รับรองก่อนเปิดใช้งาน

### 5.3 Frame Upload

- Layer order: background → photos → transparent full-canvas PNG frame
- Frame ผูกกับ booth/output/layout/language
- Admin ดาวน์โหลด guide PNG และ clean upload template ของแต่ละ Layout ได้
- Guide ระบุ canvas, slot, safe area, bleed และหมายเลข slot
- Admin ออกแบบทั้งกรอบใน Canva/Photoshop แล้วอัปโหลด PNG สำเร็จรูป
- ระบบไม่ตรวจหา photo slot จาก transparency อัตโนมัติ; ใช้ slot preset
- หากสัดส่วนไม่ตรง ระบบใช้ scale-to-cover แบบรักษาสัดส่วนและตัดขอบ ไม่ยืดภาพ
- ก่อนเผยแพร่ต้องแสดง preview ด้วย sample photos ทั้งสีและ dithered
- คำเตือนเรื่อง dimensions/aspect/transparency ไม่ hard-block; Admin ยืนยัน override ได้และต้องถูก audit
- Upload endpoint ตรวจ magic bytes/PNG structure/MIME, จำกัด encoded bytes และ decoded pixels, ป้องกัน decompression bomb, decode แล้ว re-encode เป็น sanitized PNG, strip metadata และ publish เฉพาะ derivative; ไฟล์เสียหรือเกิน limit ถูกปฏิเสธ
- Session active ใช้ frame version เดิมจนจบ; version ใหม่มีผลกับ Session ถัดไป
- เก็บ rollback อย่างน้อย 5 versions ต่อ frame

### 5.4 Filters

- Filter ใช้กับทั้ง set ไม่แยกรายรูป
- อยู่หน้าเดียวกับการเลือก Frame
- Phase 1: Original, Black & White, Vintage, Bright, Soft, Dramatic
- Admin เปิด/ปิดตัวเลือกได้

## 6. Redeem Code

- รูปแบบคงเดิม `AB1234`, กรอกด้วยข้อความเท่านั้น
- code ใช้ได้ครั้งเดียวและใช้ได้กับ kiosk เดียว
- lifecycle หลัก: `created → active → claimed`; terminal เพิ่ม `expired`, `revoked`, `replaced`
- เมื่อ Admin สั่งพิมพ์ ระบบ transactionally เปลี่ยน code ที่เลือกจาก `created → active` และสร้าง voucher print attempt ก่อน dispatch ไปเครื่องพิมพ์ เพื่อไม่ให้กระดาษที่พิมพ์ออกมามี code ที่ยัง inactive
- ผลการพิมพ์ voucher แยกจาก entitlement state; ถ้าผลกำกวมให้ Admin ตรวจและเลือก reprint/revoke พร้อม Audit
- สร้าง Batch จำนวนมากได้ แต่ Admin เลือกพิมพ์ทีละส่วน
- การพิมพ์ code ซ้ำต้องใช้ PIN พร้อม reason/audit
- หมดอายุเริ่มต้น 30 วันนับจาก activation/print; Admin ปรับต่อ Batch ได้
- Code ที่หมดอายุไม่ถูกลบจากรายงาน
- หาก package ของ kiosk เปลี่ยน Code เดิมต้องถูกปฏิเสธ ไม่แปลง package อัตโนมัติ
- Redeem ต้องออนไลน์; offline หยุด Session ใหม่ ยกเว้น Admin offline override
- ไม่มี failed-attempt cooldown/lockout ระดับลูกค้าที่รบกวนการกรอกปกติ ตามการตัดสินใจของเจ้าของระบบ

Compensating controls ที่ยังต้องมีโดยไม่เปลี่ยน UX:

- Device credential และ kiosk binding
- ตรวจเฉพาะ active code
- Atomic claim และ unique constraints
- บันทึก failed validation metadata โดยไม่เก็บข้อมูลส่วนตัว
- มี server-side global/per-device abuse ceiling ที่สูงกว่าการใช้งานปกติ, generic failure response และ anomaly circuit breaker ที่หยุด Redeem ชั่วคราวทั้ง kiosk เมื่อรูปแบบชัดเจนว่าเป็นการไล่เดา พร้อมแจ้ง Admin; ไม่แสดงว่า code ใดมีอยู่

## 7. Admin และ Security

### 7.1 Daily Admin

- ใช้ shared 4-digit PIN ใน Phase 1
- First-run ไม่มี PIN ถาวร `1234`; เจ้าของต้องกำหนด PIN เอง
- ใช้ PIN เพื่อเข้า Local Admin, Maintenance Mode, reprint, replacement, override และแก้ identity/config สำคัญ
- Admin ที่รู้ PIN ปัจจุบันเปลี่ยน PIN ได้ในหลังบ้าน

### 7.2 Owner Reset

- ไม่มี Recovery Key
- เจ้าของระบบใช้ Supabase Auth owner account, รหัสผ่าน และ TOTP MFA แบบออนไลน์เพื่อ reset shared PIN หรือ provision/reprovision
- Owner credential ใช้เฉพาะ security/provisioning ใน Phase 1 ไม่ถือเป็น Remote Dashboard เต็มรูปแบบ
- Password และ PIN ไม่เก็บ plaintext; ใช้ salted password hash และ rate limit สำหรับหน้า Admin
- การ reset/change PIN ทำให้ Admin session เก่าหมดอายุและบันทึก Audit
- PIN verification มี persistent exponential lockout ข้าม app restart; หลังสำเร็จออก capability อายุสั้นที่ผูก kiosk/action และจำกัดสิทธิ์ offline เฉพาะงานที่กำหนด
- Android เก็บ offline PIN verifier เป็น salted memory-hard hash ใน encrypted native SQLite โดย key อยู่ใน Keystore; failed count/locked-until ต้อง persist ข้าม reboot
- เมื่อตรวจ PIN offline สำเร็จ Native layer ออก device-signed capability ที่ผูก action, kiosk, config version, override quota, monotonic sequence และ expiry; JavaScript สร้าง capability เองไม่ได้
- หาก Keystore, encrypted database, signed override policy หรือ clock/sequence integrity ตรวจไม่ผ่าน ให้ Offline Admin Override fail closed

### 7.3 Provisioning

First-run Setup Mode ต้องกำหนด:

- kiosk name และ location
- immutable kiosk ID
- owner authentication linkage
- first shared PIN
- booth/mode/package
- camera test
- printer network configuration และ test print
- Device Credential
- Supabase connectivity และ clock correctness

เปลี่ยน identity หรือ reprovision ต้องใช้ owner authentication; PIN อย่างเดียวเปลี่ยน immutable kiosk identity ไม่ได้

Device provisioning protocol:

1. Owner + MFA เริ่ม provisioning และรับ bootstrap secret แบบใช้ครั้งเดียว อายุสั้น
2. Server ออก one-time attestation challenge; Android สร้าง device key pair ใน Android Keystore แบบ non-exportable และส่ง public key, certificate chain, challenge response และ app/package identity พร้อม bootstrap secret
3. Server แยกต่างหากจากอุปกรณ์ตรวจ certificate chain/revocation, challenge, security level, application identity และ key purpose; policy รับ StrongBox/TEE เป็นหลัก
4. Tablet ที่ไม่มี valid hardware attestation ใช้ owner-approved fallback profile ได้เฉพาะ Pilot หลังบันทึก `low_assurance`, จำกัด scope/อายุ token และต้องอยู่ใน certified hardware list
5. Server เก็บเฉพาะ hash ของ bootstrap secret และ public key แล้วออก short-lived kiosk-scoped access token
6. ทุก privileged request มี kiosk ID, nonce/request ID, issued/expiry time, body hash และ signature/proof-of-possession; nonce ถูก consume แบบ unique และหมดอายุ
7. Access token หมุนอัตโนมัติ; owner revoke device หรือ rotate credential ได้
8. APK, local database และ JavaScript bundle ไม่มี long-lived shared secret

### 7.4 Backend Boundary

- Supabase เป็น Postgres, private Storage, Edge Functions, Realtime และ scheduled cleanup
- Browser/Android app ไม่ถือ service-role key หรือ payment secret
- Kiosk ใช้ scoped device credential ที่ revoke/rotate ได้
- Kiosk ไม่เป็น Supabase Auth principal และไม่มี direct PostgREST access; Kiosk Edge Functions ตั้ง `verify_jwt=false` แล้วบังคับ custom PoP authentication เป็นขั้นตอนแรก ก่อน parse/execute business action
- Custom token ออกโดย server-held asymmetric signing key มี claims `sub=device_id`, `owner_id`, `kiosk_id`, `scope`, `jti`, `iat`, `exp`, `credential_version`; validator ตรวจ signature, expiry, revocation, scope, body hash และ one-time nonce ตามลำดับ
- API gateway/Edge Function บังคับ method allowlist, strict content type, request-size ceiling และ cheap IP/device rate limit ก่อนอ่าน/parse body ขนาดใหญ่ เพื่อลด unauthenticated DoS surface
- Mutation transaction ต้อง recheck device active status, credential version/revocation, owner/kiosk scope, nonce uniqueness/expiry และ idempotency key ใน transaction เดียวกับ business write; preflight validation อย่างเดียวไม่ถือว่าเพียงพอ
- Edge Function ใช้ service role หลังตรวจ device สำเร็จเท่านั้นและส่ง owner/kiosk IDs เข้า transaction function แบบ explicit; RLS ไม่มีการ map custom device token เป็น `auth.uid()`
- Customer flow ไม่เขียนตาราง privileged โดยตรงผ่าน anon client
- Redeem claim, replacement, PIN reset, event close และ signed download URL ผ่าน server-side transaction/Edge Function
- RLS เป็น deny-by-default และ grant เท่าที่จำเป็น
- ทุก `SECURITY DEFINER` function อยู่ใน private/non-exposed schema, ใช้ `search_path=''`, ตรวจ caller ภายใน และ revoke execute จาก `PUBLIC`, `anon`, `authenticated` ก่อน grant เฉพาะ role ที่จำเป็น
- Migration ต้อง enumerate/drop/revoke legacy function ทุก overload รวม `admin_key_ok`, `admin_verify`, `redeem_validate`, `redeem_use`, `redeem_generate` และ `redeem_list`
- ทุก tenant table มี immutable `owner_id` และ `kiosk_id` ตาม cardinality, indexed foreign keys และ policy matrix แยก `select/insert/update/delete`; tests ต้องมี cross-owner/cross-kiosk negative cases
- Migration บังคับ invalidate default PIN `1234`, revoke admin sessions, mark installation ที่ได้รับผลเป็น `unprovisioned` และ require owner-authenticated PIN enrollment

### 7.5 Network Threat Model

- Tablet, router และ printer อยู่ใน isolated WPA2/WPA3 kiosk VLAN/SSID ที่ไม่เปิด guest/client access
- ACL อนุญาต Tablet → printer TCP port ที่รับรองเท่านั้น; printer ออก Internet หรือรับ connection จาก guest network ไม่ได้
- ใช้ DHCP reservation/static mapping และ pin printer MAC/IP/profile ใน app
- หาก endpoint fingerprint/profile/MAC เปลี่ยน ให้หยุดพิมพ์และ require Admin recertification
- Hardware certification ต้องทดสอบ rogue AP, spoofed printer IP, DHCP change และ guest-device isolation

## 8. Printing Architecture

### 8.1 Reference Path

`React UI → Print Job Store → Capacitor Native Print Bridge → TCP/LAN ESC/POS Printer`

- Android 11+, RAM อย่างน้อย 4GB, camera อย่างน้อย 1080p, Wi‑Fi 5
- Dedicated Kiosk Mode, auto-start หลัง reboot, screen awake และ PIN-gated exit
- LAN เป็นช่องทางหลัก; USB-OTG เป็น optional adapter หลังผ่านการรับรอง
- iPad ไม่อยู่ใน Phase 1

### 8.2 Raster Pipeline

- Compose final color image แบบ deterministic จาก frozen session snapshot
- สร้าง monochrome raster/dithered ที่ width 576 dots
- รูป กรอบ โลโก้ และข้อความทั้งหมดถูก rasterize; ไม่พึ่ง printer font
- Dither algorithm/version ถูกบันทึกกับ asset เพื่อ reproduce ได้
- ไฟล์ dithered สำหรับ download ใช้ source เดียวกับ raster ที่ส่งพิมพ์
- ส่งเป็น stripe/chunk เพื่อลด memory pressure บน Tablet

### 8.3 Print Job State Machine

`queued → preflight → printing_copy_1 → cutting_1 → printing_copy_2 → cutting_2 → completed`

Failure/operator states: `blocked`, `retry_wait`, `ambiguous_needs_admin`, `cancelled` โดยเก็บ `last_confirmed_copy`

- ทุก job มี idempotency key และ target copy count = 2; idempotency ป้องกันการ dispatch ซ้ำจาก application แต่ไม่อ้างว่า raw TCP ให้ exactly-once
- Stock ถูกตัดเมื่อ printer acknowledgement/adapter result สำเร็จ ไม่ตัดก่อนส่งงาน
- ก่อน claim paid session ตรวจ printer reachability, paper status เท่าที่ hardware รองรับ และ queue health
- หาก printer unavailable ก่อนเริ่ม: หยุดรับ Redeem ใหม่
- หากล้มเหลวกลางงาน: เก็บ durable queue, retry และแสดง QR ได้
- Persist dispatch intent และ increment attempt ก่อน I/O; commit acknowledgement หลัง adapter ตอบ
- Automatic retry ต้องไม่เกิน target copies; หาก crash/timeout หลังส่ง bytes แล้วไม่ทราบว่ากระดาษออกหรือไม่ ให้สถานะ `ambiguous_needs_admin` แบบถาวร ห้าม auto-retry
- Reprint ใช้ PIN, reason และ Audit; ระบุจำนวน copy ที่อนุมัติ

### 8.4 Printer Certification

- Phase 1 รับรองเครื่องพิมพ์ Thermal เพียง 1 รุ่นหลักก่อน
- ระหว่างยังไม่มี hardware ใช้ Printer Simulator จำลอง success, paper out, network loss, partial print และ cutter error
- การเลือกเครื่องพิมพ์และทำ native TCP raster/cut/status proof-of-concept เป็น Hardware Gate หลัง baseline และก่อนล็อก canvas/composition implementation
- ห้ามประกาศ Printing Done จนทดสอบเครื่องจริงอย่างน้อย 200 jobs ต่อเนื่อง
- Acceptance ต้องตรวจ 2 copies, cut, Thai/image fidelity, disconnect/reconnect, paper out, reboot และ no unintended duplicate

### 8.5 Paper Estimate

- คำนวณจาก preset printed length รวม feed/cut allowance
- Admin กด “ใส่ม้วนใหม่” เพื่อ reset roll estimate
- เตือน near-low และ critical
- critical หยุดรับ Redeem ใหม่; Admin override ด้วย PIN และ reason ได้
- ค่าความยาวม้วนและ thresholds อยู่ใน certified printer profile

## 9. Offline และ Reliability

- Event Mode เปิด Session ใหม่ offline ได้
- Paid Redeem/Payment ไม่เปิด Session ใหม่เมื่อ offline
- Session ที่ authorized แล้วทำต่อจนจบได้
- Admin offline override ไม่ validate/consume Redeem Code ใด ๆ; สร้าง entitlement ชนิด `operator_offline_override` แยกต่างหาก ผูก kiosk/config/package snapshot, PIN capability, reason และ monotonic local sequence
- Override quota เริ่มต้นไม่เกิน 5 sessions ต่อ outage/config version; owner ปรับได้ขณะออนไลน์และ cache เป็น signed policy
- เมื่อ reconnect ให้ reconcile แบบ idempotent ด้วย device ID + local sequence; ห้ามแปลง override เป็น normal redeem claim และรายงานแยกยอดชัดเจน
- Local durable queue แยก upload, export, print และ audit sync
- Android Phase 1 ใช้ encrypted native SQLite แบบ WAL เป็น authoritative state สำหรับ Session, Event cutoff, entitlement, queue, lease, reference count และ Audit; IndexedDB ไม่เป็น source of truth ของ certified offline flow
- Image files ใช้ content-addressed encrypted files และ write-ahead transition: reserve row → write/fsync temp → atomic rename → commit ready state; recovery ตรวจ WAL/rows/files แล้วจัด orphan/quarantine แบบ deterministic
- Offline `Close Event` commit cutoff และ admitted-session set ลง SQLite transaction เดียวก่อนปฏิเสธ local admission ใหม่ จากนั้น sync immutable cutoff/outbox ไป Postgres แบบ idempotent; server ยอมรับ cutoff เดิมเท่านั้น ไม่สร้างชุดใหม่
- Queue item มี idempotency key, attempts, backoff, next retry และ terminal state
- Config และ template ที่ publish แล้ว cache local พร้อม hash/version
- App update ดาวน์โหลดเบื้องหลัง แต่ activate เฉพาะหน้า Home/Admin เมื่อไม่มี active session และ Admin อนุมัติ
- เก็บ previous stable bundle/config เพื่อ rollback
- Capacitor build ปิดและ unregister web Service Worker; native update เป็น signed atomic bundle พร้อม min/max schema compatibility และ rollback test
- Web/PWA build ใช้ service worker แบบไม่ `skipWaiting()`/`clients.claim()` ระหว่าง active session และ activate ผ่าน app-controlled update gate
- Power/app restart: ตรวจ incomplete session/job; ล้าง raw capture ที่ไม่ควรเก็บ และส่ง ambiguous print job ไป `ambiguous_needs_admin`

## 10. Data และ Retention

### 10.1 Cloud Assets

- Storage bucket เป็น private
- Paid expiry เป็น server-authoritative `session_completed_at + 24 hours`; upload หลัง expiry ถูกปฏิเสธและ local file ถูกล้างตาม failure runbook
- Scheduled cleanup ใช้ `active → delete_pending → deleted_verified`, claim ด้วย lease, ตรวจ upload-vs-cleanup ordering, revoke download token ก่อน delete และ retry/audit
- QR ใช้ unguessable token/signed URL อายุไม่เกิน retention
- Event assets ในระบบถูกลบหลัง Drive manifest verify + grace 24 ชั่วโมง
- Export ที่ติดขัดแจ้งเตือนต่อเนื่อง; วันที่ 25 สร้าง final recovery archive/alternate signed export และแจ้ง owner ทุกวัน วันที่ 30 เป็น absolute deletion deadline: revoke links, delete source/derivatives, verify deletion และบันทึก incident แม้ Drive export ยังไม่สำเร็จ
- ห้าม upload raw photos และ discarded retakes

### 10.2 Local Assets

- Android เก็บ metadata ใน encrypted native SQLite/WAL และภาพใน encrypted app-private content-addressed files ที่มี session namespace; IndexedDB เป็น fallback ของ Web/PWA ที่ไม่อยู่ใน offline certification ของ Pilot
- ล้างทันทีหลัง session complete/cancel/timeout เมื่อ upload/print queue ไม่ต้องใช้ไฟล์แล้ว
- Queue reference ต้องป้องกัน cleanup ลบ asset ที่ยังจำเป็น
- Asset local เข้ารหัสด้วย per-installation key ใน Android Keystore; database เก็บเฉพาะ encrypted payload/reference
- ก่อน admit Event session ระบบ reserve พื้นที่ตาม worst-case ของ layout และหยุดรับ session ใหม่เมื่อ free space ต่ำกว่า `max(2GB, 10% ของพื้นที่ app-available)` หรือไม่พอสำหรับหนึ่ง session + queue margin
- Asset deletion ใช้ transactional reference count/outbox lease; cleanup ห้ามลบ asset ที่ print/upload/export worker ยังถือ lease
- มี startup janitor ล้าง orphan files ตาม TTL

### 10.3 Metadata

- Transaction/Audit metadata เก็บ 1 ปี
- ไม่เก็บ raw image, customer identity หรือ PII ใน analytics
- Event owner email เก็บเท่าที่จำเป็นต่อ export/share และ retention policy

### 10.4 Google Drive Export Security

- OAuth refresh token อยู่เฉพาะ server-side secret store ไม่ส่งไป Kiosk
- ใช้ transactional outbox และ idempotency key ต่อ destination object
- Manifest ระบุ event/session/asset ID, byte size, SHA-256, MIME type และ destination object ID
- Share link ถูกส่งหลัง verify ทุก object เท่านั้น; partial upload resume ได้โดยไม่สร้างไฟล์ซ้ำ
- บันทึก consent/policy version และเวลาที่ share สำเร็จ แต่ไม่บันทึก URL สาธารณะแบบถาวร

## 11. Proposed Data Model

ตารางหลักและ constraints ที่ต้องสร้างผ่าน migration:

- `owners`: Supabase Auth linkage และ role เจ้าของระบบ
- `kiosks`: immutable identity, status, location, credential version
- `kiosk_config_versions`: mode/booth/package/language/hardware snapshot
- `packages`: booth type, price, copies, active period
- `layout_presets`: canonical dimensions และ slot geometry
- `frames`: logical frame metadata
- `frame_versions`: storage object, hash, canvas, language, warnings, publisher
- `filters`: allowed filter identifiers/version
- `events`: branding, owner email, state, retention/export policy
- `sessions`: mode, config snapshot, entitlement, state, timestamps
- `session_assets`: final/dithered only, retention and cleanup state
- `redeem_batches`: kiosk/package/price/expiry/print counters
- `redeem_codes`: code, lifecycle, kiosk binding, entitlement snapshot, claimed session
- `print_jobs`: idempotency, target/confirmed copies, adapter/printer, state
- `print_attempts`: attempt/copy/result/error/ack metadata
- `replacement_entitlements`: original session/code, reason, issuer, consumed session
- `audit_logs`: append-only actor type, kiosk, action, reason, before/after metadata
- `event_exports`: destination, expected/uploaded/verified counts, retries, share state
- `device_health_events`: camera/printer/network/storage/queue metadata
- `device_credentials`: public key, attestation result/security level, credential version, status, expiry
- `device_bootstraps`: one-time secret hash, challenge, expiry, consumed timestamp
- `device_token_revocations`: device/JTI/credential-version revocation and reason
- `device_request_nonces`: unique device + nonce, body hash, issued/expiry/consumed timestamps
- `admin_capabilities`: kiosk/action scopes, issued/expiry/revoked metadata; no raw PIN
- `admin_lockouts`: failed count, backoff/locked-until and last failure persisted per kiosk
- `outbox_events`: aggregate/type/payload hash, idempotency key, lease, attempts, next retry, dead-letter state
- `offline_override_entitlements`: device/local sequence unique key, signed policy version, package snapshot, reason and reconciliation state

ฐานข้อมูลต้องมี foreign keys, unique constraints, check constraints, partial indexes ตาม query path และ transaction-safe RPC สำหรับ operations ที่ต้อง atomic ห้ามใช้ trigger เพื่อซ่อน business flow ที่ควรเห็นใน application service เว้นแต่เป็น audit/integrity ที่พิสูจน์ความจำเป็นแล้ว

ก่อนออกแบบ migration ใหม่ต้อง dump และ version-control เฉพาะ schema metadata ของ Production/Test ที่ใช้งานจริง ได้แก่ tables, columns, constraints, indexes, RLS policies, grants, functions/overloads, cron jobs, storage buckets/policies และ Edge Function inventory แล้ว reconcile drift ของ `kiosk_sessions`, `layout_sizes`, `custom_themes` และ bucket ที่ client เดิมเรียกใช้ ห้ามสมมติว่า migration เดียวใน repo คือ source of truth

## 12. Application Architecture

Refactor เป็น Vite + React + TypeScript PWA และ Capacitor Android shell โดยแบ่งโมดูล:

- `app-shell`: routing, kiosk lifecycle, update gating
- `session`: state machine และ frozen config snapshot
- `camera`: capability detection, preview mirror, countdown 3/5/10, sound
- `composition`: layout slots, frame/filter render, deterministic exports
- `printer`: adapter interface, simulator, Android LAN ESC/POS adapter
- `entitlement`: Redeem และ future Payment adapter
- `offline-queue`: durable idempotent workers
- `event-export`: close/verify/share orchestration
- `admin`: setup, configuration, templates, health, reports, audit
- `i18n`: Thai/English และ RTL-ready message architecture
- `data`: Supabase client, typed contracts, Edge Function calls

กำหนด interfaces ที่ Phase 1 ใช้จริง:

- `PrinterAdapter` เพื่อเพิ่ม SELPHY/Windows/USB ใน Phase 2B
- `EntitlementService` สำหรับ Redeem โดยไม่ implement Payment provider ล่วงหน้า
- `StorageExporter` สำหรับ Google Drive โดยไม่สร้าง abstraction เกิน provider ที่มีจริง

Phase 2/3 เก็บเพียง ADR และ extension seam; ยังไม่สร้าง `PaymentProvider` หรือ `ImageEffectPipeline` จน provider/requirements ถูกล็อก

## 12.1 RLS and Ownership Matrix Requirement

ก่อนเขียน migration ต้องจัดทำ matrix สำหรับทุก table ระบุ owner cardinality, kiosk cardinality, actor (`owner`, `device`, `shared_admin capability`, `system worker`), operation และ predicate:

- Owner อ่านข้อมูลของ `owner_id = auth.uid()` เท่านั้น
- Device อ่าน config/template ของ kiosk ตัวเองและเรียก operation ผ่าน signed server endpoint เท่านั้น
- Kiosk ไม่มี direct table mutation สำหรับ redeem claim, PIN, replacement, export close หรือ retention
- System worker ใช้ service role เฉพาะ function ที่จำเป็นและต้องสร้าง audit/correlation ID
- ไม่มี client role ใด enumerate redeem codes หรือ private asset object paths

## 12.2 Canonical State Machines

สร้าง machine-readable state specification เป็น source of truth เดียว แล้ว generate TypeScript enums/transition guards, Postgres check constraints และ transition tests ห้ามสร้างชื่อ state เพิ่มเฉพาะใน UI หรือ worker

### Redeem

- `created → active` เมื่อสร้าง voucher print intent ก่อน dispatch
- `active → claimed` เมื่อ atomic claim สร้าง authorized session
- `created|active → expired|revoked`
- `active|claimed → replaced` เมื่อ Admin ออก replacement entitlement ตาม policy
- Voucher print attempt มี state ของตัวเองและไม่เปลี่ยน entitlement ย้อนกลับแบบอัตโนมัติ

### Session

- `created → authorized → selecting → capturing → composing → print_queued → completed`
- Event entitlement สร้าง `authorized` โดยไม่ผ่าน Redeem
- Terminal alternatives: `cancelled`, `timed_out`, `failed`, `abandoned`
- `completed` หมายถึง final assets/required outbox ถูกสร้างแล้ว ไม่ได้อ้างว่ากระดาษออกทางกายภาพครบ

### Event

- `draft → open → closing → exporting → verified → closed`
- `exporting → export_failed → exporting` สำหรับ controlled retry
- `closing` เกิดพร้อม immutable cutoff/admitted-session set; ไม่มีทางกลับ `open`

### Print Job

- `queued → preflight → printing_copy_1 → cutting_1 → printing_copy_2 → cutting_2 → completed`
- Recoverable: `preflight|printing_*|cutting_* → retry_wait → preflight` เฉพาะเมื่อพิสูจน์ว่ายังไม่ dispatch bytes ของ copy นั้น
- Operator states: `blocked`, `ambiguous_needs_admin`, `cancelled`
- `ambiguous_needs_admin` ไม่มี automatic outgoing transition; Admin สร้าง audited reprint job ใหม่หรือปิด incident

### Asset

- `local_pending → upload_queued → uploaded → delete_pending → deleted_verified`
- Event export branch: `uploaded → export_queued → exported_verified → delete_pending`
- `upload_queued|export_queued → retry_wait|dead_letter`; manual recovery สร้าง attempt ใหม่โดยคง asset identity/hash เดิม

### Export

- `pending → uploading → verifying → shared → completed`
- `uploading|verifying|shared → retry_wait → uploading`
- เกิน max attempts เป็น `dead_letter`; หลังแก้สาเหตุ resume ไป `uploading` ด้วย manifest/idempotency เดิม

## 13. Admin Functions — Phase 1

- Setup/Provisioning
- เลือก Event หรือ Paid Redeem
- เลือก Package และ Layout ที่เปิดใช้
- ตั้ง price, countdown, audio, camera mirror และภาษาเริ่มต้น
- สร้าง/พิมพ์ Redeem Batch บางส่วน และดูสถานะ
- อัปโหลด Preview Publish และ Rollback Frame
- เปิด/ปิด Filter
- Event create/open/close/export status
- Replacement entitlement พร้อม reason
- Print queue/reprint พร้อม reason
- Camera preview และ capture test
- Printer connection/test print/paper reset
- Network/Supabase/clock/storage/template/font checks
- Upload/export/audit queue status
- Maintenance Mode และ diagnostic report ที่ไม่มีภาพ
- รายงาน Session, Paid/Event/Offline override, sales/redeem, print, reprint, paper estimate, replacements และ health
- CSV export ตามช่วงวันที่
- CSV serializer neutralize cell ที่ขึ้นต้นด้วย `=`, `+`, `-`, `@`, tab หรือ carriage return และมี malicious-value tests เพื่อป้องกัน formula injection

## 14. Implementation Sequence

### Milestone 0 — Repository and Safety Baseline

- แก้ความคลาดเคลื่อน path/workspace ก่อนเริ่ม code changes
- Inventory และ preserve user changes ปัจจุบันทั้งหมดก่อนแตะไฟล์; ห้ามทับ dirty worktree
- เอา generated `node_modules`/cache ออกจาก tracking แบบไม่ลบ dependency ของผู้ใช้ แล้วแก้ `.gitignore`
- dump/reconcile deployed Supabase schema, RLS, functions, grants, storage และ Edge Functions กับ migration history
- จัดทำ legacy data disposition ราย table: backfill เฉพาะค่าที่พิสูจน์ kiosk/package/owner ได้; code/session/theme ที่พิสูจน์ไม่ได้ให้ export backup แล้ว revoke/invalidate พร้อม owner report
- ทำ migration dry run บน production clone, ตรวจ row counts/foreign keys/code uniqueness/active entitlement invariants, freeze writes ระหว่าง cutover, backup ก่อนเปลี่ยน และกำหนด rollback point ก่อน destructive migration
- ลำดับ cutover: บังคับ full kiosk maintenance mode และ freeze legacy mutation ทุกชนิดรวม `redeem_use`/session/upload/admin → รอ in-flight requests จบ → backup/dump → deploy additive schema/functions → backfill/verify → switch client endpoints → revoke legacy grants/functions → monitor → cleanup หลัง rollback window
- หากไม่สามารถหยุด legacy client ทุกตัวได้ ห้าม cutover แบบ backfill ครั้งเดียว; ต้องใช้ dual-write/claim bridge ที่ transactionally reconcile code claims จน new endpoint เป็น authority แล้วจึง revoke legacy path
- สร้าง branch และ clean baseline commit ที่ระบุ source revision, deployed schema revision, build hash และ deployment URL
- แยก legacy prototypes ออกจาก runtime inputs โดยไม่ลบไฟล์ผู้ใช้
- เพิ่ม lint, typecheck, unit test และ CI build
- สร้าง environment matrix: local/test/production และ secret inventory

### Milestone 1 — Hardware Gate and Technical Spikes

- เลือก candidate thermal printer 1 รุ่นตาม LAN/USB, 576-dot raster, cutter และ status support
- ทำ Capacitor proof-of-concept: Android fully-managed Device Owner/DPC enrollment, lock-task allowlist, overlay/settings restriction, boot recovery, camera, Keystore และ TCP raster/cut/status
- ทดสอบ physical escape ผ่าน Home/Overview/notifications/power/reboot/USB/debugging; production profile ปิด developer/ADB access และมี owner-authenticated maintenance exit
- ทดสอบ buffer/chunk, Thai raster fidelity, network loss และ acknowledgement limits บนเครื่องจริง
- ล็อก printer capability profile และ canvas lengths หลัง spike ผ่าน; ถ้ายังไม่มีเครื่องจริง อนุญาตให้ทำ Milestone 2 บางส่วน แต่ห้าม finalize composition/printing

### Milestone 2 — React/TypeScript Shell and Domain State

- Scaffold React TypeScript ใน Vite เดิมแบบ incremental
- สร้าง design tokens/components และ Thai/English i18n
- สร้าง typed session/config state machines
- ย้าย Home/Layout/Capture/Retake โดยเทียบ behavior เดิม
- เพิ่ม timeout warning, cleanup และ deterministic test fixtures

### Milestone 3 — Supabase Foundation

- เขียน migration data model, constraints, indexes, RLS และ grants ใหม่
- ปิด privileged anon RPC เดิมและย้าย operations ไป authenticated Edge Functions/RPC
- สร้าง owner auth, device provisioning/credential rotation และ shared PIN verifier
- ทำ owner TOTP MFA, default-PIN invalidation และ persistent admin lockout/capability expiry
- ทำ atomic Redeem lifecycle, replacement และ append-only audit
- ทำ RLS ownership matrix และ policy tests ก่อน expose endpoint
- เพิ่ม seed/test data และ database policy tests

### Milestone 4 — Composition and Template Management

- สร้าง canonical layout presets/canvas lengths
- สร้าง downloadable guides และ clean templates
- สร้าง upload validation, scale-to-cover preview, warning override และ version publish
- รวม Frame + Filter UI และ deterministic final/dither generation
- เพิ่ม private storage, signed download และ cleanup policy

### Milestone 5 — Android Kiosk and Printing

- Wrap React app ด้วย Capacitor Android
- ทำ Dedicated Kiosk Mode, auto-start และ admin exit
- นิยาม native printer bridge และ simulator
- ทำ TCP/LAN ESC/POS raster/chunk/cut/status integration
- ทำ durable idempotent print queue, progress และ admin reprint
- ทำ paper estimate และ health checks
- ซื้อ/เลือกเครื่องจริง 1 รุ่นและทำ certification suite 200 jobs

### Milestone 6 — Customer and Event End-to-End

- ต่อ Paid Redeem flow ทั้งเส้น
- ต่อ Event offline flow และ local queue
- ทำ atomic Close Event leases, Drive manifest/hash verification และ share notification
- ทำ QR download, 24-hour paid retention และ no-raw verification
- ทำ recovery/replacement/admin audit flows

### Milestone 7 — Operations and Pilot

- Admin reports/CSV/diagnostics/update gating
- E2E tests บน Android reference hardware
- Security/RLS, offline, storage pressure, power-loss และ printer fault tests
- Thai/English touchscreen accessibility and usability test
- Pilot หนึ่งตู้ พร้อม runbook, backup/rollback และ incident checklist
- เก็บปัญหาจาก Pilot ก่อนเปิดหลายตู้

## 14.1 Observability and Initial SLOs

ทุก log/event ใช้ correlation IDs: `owner_id`, `kiosk_id`, `event_id`, `session_id`, `entitlement_id`, `print_job_id` เท่าที่เกี่ยวข้อง และห้ามใส่ภาพ/PIN/code เต็ม/OAuth token

- Authorized session creation availability ≥ 99.5% ระหว่างที่ Internet/Supabase ปกติ
- Redeem claim p95 ≤ 2 วินาที; circuit breaker alert ภายใน 1 นาทีเมื่อ abuse threshold ทำงาน
- Paid asset cleanup lag ≤ 15 นาทีหลัง expiry; alert เมื่อเกิน 30 นาที
- Event export queue oldest age alert ที่ 15 นาทีหลัง reconnect และ incident ที่ 2 ชั่วโมง
- Local storage alert ที่ 15% free; admission block ตาม threshold ในข้อ 9
- Print ambiguity, dead-letter queue, revoked device request และ owner PIN reset แจ้งใน Local Admin ทันทีและ sync ไป owner notification channel เมื่อออนไลน์
- ทุก queue มี max automatic attempts, exponential backoff, dead-letter state และ documented manual recovery

## 15. Required Test Matrix

- Redeem: created/active/expired/claimed/revoked/replaced/wrong kiosk/wrong package/concurrent claim
- Session: every allowed state transition, timeout, crash/reload, config change mid-session
- Camera: denied permission, missing camera, mirror, portrait/landscape, retake unlimited
- Composition: every layout, frame crop warning, filter, Thai/English, deterministic hash
- Print: success 2/2, fail before copy 1, fail between copies, ambiguous ack ห้าม auto-retry, paper out, network loss, reboot, reprint audit
- Offline: event start/finish, queued export, reconnect, duplicate sync prevention, paid blocking, override audit
- Retention: paid delete by 24h, signed URL expiry, event export verify, local orphan cleanup, no raw upload
- Security: RLS cross-owner/cross-kiosk isolation, revoked device, replay/forged kiosk ID, admin PIN persistent lockout, owner MFA reset, secret absence in APK/bundle
- Provisioning: attestation challenge/replay/revocation, low-assurance fallback, DPC lock-task escape, token rotation and nonce uniqueness
- Export: hash/size mismatch, partial Drive upload resume, absolute retention deletion และ CSV formula-injection payloads
- Accessibility: large touch targets, countdown sound toggle, TH/EN copy, no customer dead end
- Performance: camera-to-preview, composition time, printer transfer memory, long event queue and storage pressure

## 16. Definition of Done — Phase 1

Phase 1 พร้อมเปิด Pilot เมื่อ:

- Customer Flow และ Admin Flow ที่อยู่ใน scope ผ่าน automated/E2E tests
- Migration/RLS/security tests ผ่าน และ production bundle ไม่มี privileged secret
- Redeem atomic one-time use ตรง kiosk/package
- รูป local ถูกล้าง และ Cloud ไม่มี raw/discarded images
- Paid cleanup ภายใน 24 ชั่วโมงทำงานพร้อม retry/verification
- Event offline/export/atomic close/manifest hash verification/absolute retention ผ่าน
- Audit ครบสำหรับ replacement, reprint, override, config publish และ PIN reset/change
- Android Kiosk Mode ฟื้นตัวหลัง reboot
- เครื่องพิมพ์รุ่นรับรองผ่าน 200 jobs และ fault matrix โดยไม่เกิด automatic duplicate; ambiguous physical outcome ถูกหยุดรอ Admin เสมอ
- Pilot hardware หนึ่งตู้ผ่าน owner acceptance
- มี runbook สำหรับ paper, printer failure, offline, replacement, event close และ PIN reset

## 17. Explicitly Out of Scope for Phase 1

- Dynamic QR Payment และ automatic refund
- Canon SELPHY production support
- iPad silent printing
- Remote multi-kiosk dashboard
- Individual staff accounts
- Beauty/AR/Stickers
- Malay/Arabic UI
- Raw photo cloud archive
- Permanent public gallery
- Customer self-service recovery entitlement
- Arbitrary layout editor หรือ automatic slot detection

## 18. Risks Accepted or Deferred

- Redeem format สั้นและไม่มี failed-attempt cooldown ตามการตัดสินใจของเจ้าของระบบ; ต้อง monitor และจำกัด exposure ด้วย activation/kiosk binding
- Shared 4-digit PIN ระบุผู้ปฏิบัติงานรายบุคคลไม่ได้; Audit actor เป็น `shared_admin` จนถึง Phase 3
- Printer completion บางรุ่นยืนยันระดับ physical paper ไม่ได้; ambiguous result ต้องหยุดรอ Admin ไม่ retry แบบเสี่ยงพิมพ์ซ้ำ
- ยังไม่มีเครื่องพิมพ์จริง; hardware certification เป็น launch gate
- Workspace path กับ source repository path ไม่ตรงกัน; ต้องแก้ก่อน implementation
- Redeem abuse ceiling/circuit breaker ปกป้องระบบระดับโจมตี แต่ยังคงไม่มี cooldown ระดับลูกค้าตาม requirement; entropy risk ของ `AB1234` ยังเป็น accepted residual risk

## 19. Locked Decisions and Remaining Non-blocking Work

ข้อกำหนดด้านผลิตภัณฑ์และสถาปัตยกรรมสำหรับ Phase 1 ถือว่าล็อกแล้ว ไม่มีคำถามบังคับค้างอยู่ การเลือกรุ่น Thermal ที่จะรับรองและค่าความยาว canvas จริงเป็น Hardware Gate ใน Milestone 1 โดยต้องขออนุมัติก่อนซื้อ; งาน baseline และ React shell บางส่วนเดินหน้าได้ แต่ห้าม finalize composition/printing ก่อนผ่าน spike เครื่องจริง

การเปลี่ยน requirement หลังอนุมัติแผนต้องบันทึกเป็น change request ระบุผลต่อ Phase, schema, hardware, tests และราคา/เวลา
