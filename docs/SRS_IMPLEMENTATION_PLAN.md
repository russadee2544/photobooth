# แผนพัฒนาระบบ Photo Booth จาก SRS

เอกสารนี้ใช้ SRS เป็นเป้าหมาย โดยรักษาโครงและหน้าตาของระบบเดิม (`home → layout → capture → retake → template → filter → processing → print`) และค่อย ๆ เปลี่ยนแกนภายในให้รองรับงานจริงโดยไม่บังคับย้ายระบบทั้งหมดในครั้งเดียว

## หลักการพัฒนา

1. ใช้ Template JSON Schema เป็นแหล่งข้อมูลเดียวของหน้าเลือกเลย์เอาต์ จำนวนภาพที่ต้องถ่าย พรีวิว การเรนเดอร์ และงานพิมพ์
2. เก็บ Kiosk runtime แบบ offline-first งานถ่ายและพิมพ์ต้องไม่ขึ้นกับอินเทอร์เน็ต
3. แยกงานที่มีผลภายนอกเป็น gateway/queue เช่น print, upload, SMS และ email เพื่อ retry ได้โดยไม่สร้างงานซ้ำ
4. รักษาข้อมูลภาพดิบเฉพาะช่วง session และล้างหลังสร้าง final asset สำเร็จ
5. พัฒนาแบบเพิ่มความสามารถ (backward-compatible) เพื่อให้โหมด thermal และธีมเดิมยังทำงานได้

## สถานะที่พัฒนาแล้วในรอบนี้

| ข้อกำหนด | ผลที่พัฒนา |
|---|---|
| Template JSON Schema | เพิ่ม schema version, canvas, DPI, safe margin, overlay, slots, focus point, rotation, z-index และ print settings |
| 2x6 / 4x6 | มี preset 600×1800, 1200×1800 และ 1800×1200 ที่ 300 DPI พร้อมโหมด 4x6 Postcard แนวตั้ง/แนวนอน |
| Media graphic specs | กำหนดค่ากลาง GIF 960×720/1080×1080, Video 1080×1920/1080×1080 และ Welcome iPad 2732×2048 |
| Multi-Up | 2x6 สามารถทำสำเนาคู่บน 4x6 ขนาด 1200×1800 พร้อมเส้นตัดกลาง |
| Center crop | ทุก slot ใช้ cover crop โดยไม่ยืดภาพ และกำหนด focus X/Y ได้ |
| Capture workflow | จำนวนช็อตอ่านจาก `slots.length` ของ schema เดียวกับ compositor |
| Safe zone | Editor แสดงเส้น safe zone และเตือน slot ที่ล้ำเขต |
| Slot editor | รองรับ drag, X/Y/Width/Height/Rotation, Duplicate, Remove และคำสั่ง z-index 4 แบบ |
| Overlay | รองรับ PNG โปร่งใสต่อ template และธีม PNG เดิม |
| Multi-layout | เปิด/ปิดและเก็บหลาย template ต่อ layout/paper mode ได้ |
| Import/Export | ส่งออกและนำเข้า catalog เป็น JSON เพื่อย้ายค่าระหว่างตู้ |
| Rendering performance | ตัดเวลารอจำลอง และไม่สร้าง dither สำหรับ photo printer; บันทึกเวลา render ใน session |
| Offline | Catalog และ overlay เก็บใน local-first configuration; service worker cache engine/editor |

## Roadmap แนะนำ

### ระยะ 1 — Layout & Frame Foundation (เสร็จแล้ว)

- Template schema และ validation
- Template & Frame Editor
- เชื่อม schema กับ capture/compositor/print
- 2x6 dual-strip และ 4x6 postcard
- Unit tests และ browser QA

เกณฑ์รับงาน: จำนวนช็อตตรงกับจำนวน slot, ผลลัพธ์ตรงขนาด 300 DPI, ภาพไม่บิด, overlay อยู่บนภาพ, ค่าเดิมยังใช้งานได้

### ระยะ 2 — Event Configuration & Cloud Sync

- สร้าง Event และ Duplicate Event
- ผูกหลาย template, welcome screen, theme และ capture parameters ต่อ Event
- เพิ่ม revision/config version เพื่อให้ตู้ sync ค่าใหม่แบบ atomic
- เก็บ asset ขนาดใหญ่ใน Storage; เก็บเฉพาะ metadata/URL ใน Postgres
- เพิ่ม RLS แยก tenant/event/kiosk และ audit log สำหรับการแก้ config
- เพิ่ม local config snapshot เพื่อเปิดงานได้แม้ Supabase ขาดการเชื่อมต่อ

เกณฑ์รับงาน: Duplicate Event ได้ครบ, ตู้เปิด event เดิมได้แบบ offline, config ที่กำลังใช้งานไม่เสียเมื่อ sync ล้มเหลว

### ระยะ 3 — Capture Workflow

- เพิ่มหน้าก่อนถ่ายสำหรับเลือก Photo / GIF / 360 / Video โดยแสดงเฉพาะโหมดที่ hardware รองรับ
- Countdown แยกรูปแรก/รูปถัดไป, virtual attendant และ preview หลังถ่ายประมาณ 2 วินาที
- Camera adapter สำหรับ front/back/webcam และ native bridge สำหรับ DSLR/PTP
- เพิ่ม background removal adapter (Chroma Key ก่อน แล้วจึง AI provider)
- เพิ่ม Digital Props แบบ layer ที่บันทึกใน composition schema

เกณฑ์รับงาน: เปลี่ยนกล้องได้โดยไม่เสีย session, ถ่ายครบตาม slot, retake รายรูปได้ไม่จำกัดก่อนยืนยัน

### ระยะ 4 — Delivery, Print Queue & Recovery

- เปลี่ยนงานพิมพ์เป็น persistent queue พร้อม idempotency key
- แยกสถานะ `queued / dispatching / completed / failed / ambiguous`
- เพิ่ม queue monitor และ operator recovery โดยไม่พิมพ์ซ้ำอัตโนมัติเมื่อผลไม่ชัดเจน
- เพิ่ม upload queue, Live Gallery และ QR URL
- เพิ่ม SMS/Email queue โดยอนุญาต download URL ของระบบเพียงลิงก์เดียว
- AirDrop/native share ทำงานได้แบบ offline

เกณฑ์รับงาน: ปิดแอประหว่างส่งงานแล้วกลับมาทำต่อได้, network retry ไม่สร้างไฟล์หรือข้อความซ้ำ, งานพิมพ์ ambiguous ต้องให้ Admin ตัดสินใจ

### ระยะ 5 — GIF, Video และ Production Hardening

- GIF 3–4 เฟรมแบบ reverse loop
- 360 Slow-Mo speed curve และ motion trigger ผ่าน native bridge
- Video message 10–60 วินาที และ overlay ผ่าน WebCodecs/FFmpeg
- benchmark render บนอุปกรณ์เป้าหมาย โดย 4x6 final composite ต้องไม่เกิน 2 วินาที
- soak test, storage pressure test, printer disconnect test และ network loss test
- observability: queue depth, render latency, print failure, upload retry และ kiosk heartbeat

เกณฑ์รับงาน: ผ่าน test matrix ของ hardware จริง, ไม่มี raw media ค้างหลัง timeout, queue ฟื้นตัวเองได้หลัง reboot

## งานทดสอบที่ต้องคงไว้ทุก release

- Schema migration/normalization จาก config รุ่นก่อน
- Slot count กับ capture count ต้องเท่ากันทุก layout
- 2x6 = 600×1800, dual 4x6 = 1200×1800, postcard = 1200×1800 ที่ 300 DPI
- Crop แนวตั้ง/แนวนอนโดยไม่ยืดภาพ
- Overlay โปร่งใสและลำดับ z-index
- Safe zone 3–5 มม. ตาม media/printer profile
- Inactivity timeout ล้าง raw photos และ session ของผู้ใช้คนก่อน
- Offline capture/print และ queue recovery หลังกลับมาออนไลน์
- Print idempotency และ ambiguous outcome

## ข้อจำกัดที่ยังไม่ควรถือว่าเสร็จ

- Catalog ในรอบนี้เป็น local-first และยังไม่ได้ sync ต่อ Event ใน Supabase
- GIF, 360, Video, AI background removal, QR gallery, SMS และ Email ยังเป็นระยะถัดไป
- เป้าหมาย render ต่ำกว่า 2 วินาทีต้อง benchmark บนอุปกรณ์ Kiosk และไฟล์ overlay จริง ไม่ควรสรุปจากเครื่องพัฒนาเพียงเครื่องเดียว
- DSLR/PTP, AirDrop และเครื่องพิมพ์จริงต้องผ่าน native bridge และ hardware certification
