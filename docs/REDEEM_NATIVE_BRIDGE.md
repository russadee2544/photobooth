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
