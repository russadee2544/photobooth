# สัญญาเชื่อม Android/เครื่องพิมพ์สำหรับแพ็กเกจ Redeem

หน้าเว็บหลักเรียก `window.PhotoboothDevice` และ `window.PhotoboothPrinter` แต่ repository นี้ไม่มีซอร์ส Android/native bridge จึงต้องเติมเมธอดด้านล่างในแอปตู้ก่อนใช้กับเครื่องจริง โหมดจำลอง localhost `?demo=1` ทดสอบหน้าจอและยอดได้โดยไม่พิมพ์กระดาษ

## API ที่เว็บเรียกได้

`PhotoboothDevice.claimPrintPass({code,kioskId,previousToken})` → เรียก Edge Function `redeem-pass` operation `claim`; คืน `{passId,sessionToken,quotaKind,printLimit,usedPrints,remaining,copiesPerPrint,validUntil}` หรือ `{error}`

`PhotoboothDevice.touchPrintPass({kioskId,passId,sessionToken})` → operation `touch` เมื่อมีการใช้งานจริง ไม่ต่ออายุจาก background timer อย่างเดียว

`PhotoboothDevice.reservePrintPass({kioskId,passId,sessionToken,jobId,assetSha256})` → operation `reserve`; คืน `{jobId,status,copies,remaining}` งานเดิม/ผลเดิมเมื่อส่งซ้ำด้วย jobId เดิม

`PhotoboothDevice.pausePrintPass({kioskId,passId,sessionToken})` → operation `pause`; คืน `{paused:true}` และเก็บผลการพิมพ์ที่ยังค้างตรวจไว้ฝั่ง agent

`PhotoboothPrinter.printAuthorizedPass({kioskId,passId,sessionToken,jobId,dataUrl,paperMode,copies})` → ตรวจ `assetSha256` ของ dataUrl ให้ตรงกับงานที่จอง, เรียก operation `start` ก่อนเริ่มเครื่องพิมพ์, ตรวจ copies/asset hash จาก server แล้วพิมพ์ด้วย jobId คงเดิม, เรียก operation `report` จากโค้ด native ภายในเท่านั้น คืน `{status:'completed',remaining,copiesCompleted}` เฉพาะเมื่อได้รับผล `completed` จาก server แล้ว ถ้าผลไม่แน่ชัดคืน `ambiguous` ไม่ส่งงานซ้ำเอง

`PhotoboothDevice.generatePrintPasses({kioskId,packageId,count,expiresDays,quotaKind})` → แอดมินที่ผ่าน PIN เรียก `admin-redeem` operation `generatePass` โดย native ถือ capability token; raw codes คืนครั้งเดียวและต้องเก็บรอพิมพ์ใน encrypted native storage

`PhotoboothDevice.listPrintPasses({kioskId})` → `admin-redeem` operation `listPass`; คืนข้อมูล code hint และยอดโดยไม่เปิด raw code จากฐานข้อมูล

`PhotoboothPrinter.printPrintPasses({kioskId,count})` และ `resolvePrintPassCodes({jobId,resolution})` → พิมพ์รหัสจาก native encrypted storage และรายงาน `admin-redeem` operation `markPassPrinted` เมื่อยืนยันพิมพ์บัตรแล้ว

## ข้อบังคับที่ต้องมีใน native agent

- เก็บ device credential และ admin capability ไว้ใน native secure storage; ห้าม expose คีย์หรือเมธอดทั่วไปที่เรียก Edge Function ได้ตามใจหน้าเว็บ
- `start` และ `report` เป็นคำสั่งภายใน agent เท่านั้น หน้าเว็บเรียกไม่ได้
- บันทึก jobId และสถานะลงพื้นที่ถาวรก่อนส่งคำสั่งเครื่องพิมพ์ เพื่อกู้หลังแอปปิด/เปิดใหม่
- ถ้าไม่ทราบว่ากระดาษออกแล้วหรือยัง ให้รายงาน `ambiguous` และรอพนักงานตรวจ ห้ามส่งซ้ำเครื่องเดิมหรือ fallback ไปอีกเครื่องอัตโนมัติ
- `failed` ใช้เฉพาะเมื่อพิสูจน์ว่าไม่ได้กระดาษและไม่มีงานค้างที่จะถูกพิมพ์ภายหลัง
- ต้องกัน jobId เดิมไม่ให้ส่งเครื่องพิมพ์ซ้ำ และตรวจจำนวนใบจาก server ไม่รับจำนวนที่ browser เปลี่ยนเอง
- หลังระบบปิดรอบลูกค้า ต้องล้างรูปและ session token จาก browser แต่ยังยอมรับรายงานผลของงานที่เริ่มพิมพ์ก่อนปิดรอบ
- ถ้าติดตั้งตู้ที่อนุญาต WebUSB หรือ system print ใน browser โดยตรง หน้าเว็บอาจถูกใช้ข้าม agent ได้ ให้ปิดเส้นทางเหล่านั้นในโหมดขายจริง

Migration: `supabase/migrations/20260928071608_redeem_print_passes.sql`; Edge Function: `supabase/functions/redeem-pass` และ `admin-redeem`. ยังต้องนำขึ้นโปรเจกต์ Supabase ที่ใช้กับตู้นี้และทดสอบบนเครื่องพิมพ์จริง

## ชำระเงิน PromptPay ผ่าน Stripe (`buy.html`)

Migration: `supabase/migrations/20261004090000_stripe_promptpay_orders.sql`; Edge Functions: `payment-order` (เรียกจาก native agent) และ `payment-webhook` (Stripe เรียกตรง ตรวจ signature)

เมธอดที่ native `PhotoboothDevice` ต้องเพิ่ม (ใช้ `x-kiosk-credential` เดียวกับ `redeem-pass` เรียก `payment-order` ตาม operation):

- `listPassOffers({kioskId})` → operation `offers`; คืน `{offers:[{packageId,quotaKind,priceMinor,currency,copies}]}`
- `createPaymentOrder({kioskId,packageId,quotaKind})` → operation `create`; คืน `{orderId,amountMinor,currency,expiresAt,qr:{data,imageUrlPng,imageUrlSvg}}`
- `getPaymentOrder({kioskId,orderId})` → operation `status`; คืน `{status,code?}` โดย `code` (รหัส 5 ตัว) มาเมื่อ `status:'paid'` และส่งซ้ำได้จนกว่า pass จะถูก claim
- `cancelPaymentOrder({kioskId,orderId})` → operation `cancel`

เมื่อจ่ายแล้ว หน้าเว็บเรียก `claimPrintPass(code)` เดิม ทำให้เงื่อนไขแพ็กเกจ (2 / 5 ครั้ง / ไม่จำกัด, หมดอายุ, จำนวนใบต่อครั้ง) ใช้ชุดเดียวกับบัตร redeem

ตั้งค่า (Supabase secrets): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BILLING_EMAIL` (อีเมลที่ Stripe บังคับสำหรับ PromptPay ไม่แสดงให้ลูกค้า) และใน Stripe Dashboard ชี้ webhook ไปที่ `payment-webhook` รับ event `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`

ราคา: เพิ่มแถวในตาราง `booth_pass_offers` (`price_minor` เป็นสตางค์ ขั้นต่ำ 2000 = ฿20) ต่อ `package_id` + `quota_kind`

ชำระหลังออเดอร์หมดเวลา/ถูกยกเลิก: webhook คืนเงินอัตโนมัติ (`refund_required`)

## GIF ดาวน์โหลด (`session-gif`)

Migration: `supabase/migrations/20261004120000_session_gif_assets.sql`; Edge Function: `session-gif`

เมธอดที่ native `PhotoboothDevice` ต้องเพิ่ม (ใช้ `x-kiosk-credential` เรียก `session-gif` แบบ JSON):

- `issueGifUploadTicket({kioskId,sessionId,mode,passId,sessionToken,packageId})` → operation `ticket`; คืน `{ticket,expiresAt}` หรือ `{error}` โหมด `redeem` ต้องส่ง `passId` + `sessionToken` ของสิทธิ์พิมพ์ที่กำลังใช้ โหมด `event` ผูกกับตู้ที่ยืนยันแล้ว หน้าเว็บเรียกตอนเปิด `layout.html` (ต้นทุก Session)

หน้าเว็บอัปโหลด GIF เองด้วย ticket (ไม่มี credential): `POST /functions/v1/session-gif` header `Content-Type: image/gif`, `x-gif-ticket` → `{assetId,downloadUrl,expiresAt}` ticket ใช้ได้ครั้งเดียว อายุ 3 ชั่วโมง `downloadUrl` เป็นลิงก์สั้น `?a=<assetId>` ที่ redirect ไป signed URL อายุ 5 นาที และใช้ไม่ได้ (410) หลัง 24 ชั่วโมง

ลบไฟล์หมดอายุ: ทำอัตโนมัติทุกครั้งที่ออก ticket และเรียกตามรอบได้ด้วย `POST {operation:'purge'}` + header `x-purge-secret` (ตั้ง secret `GIF_PURGE_SECRET` ก่อน)
