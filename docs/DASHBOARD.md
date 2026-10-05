# แดชบอร์ดเจ้าของ (`/dashboard`)

หน้าเว็บสำหรับดูสถานะและยอดของทุกตู้: ออนไลน์/ขาดการติดต่อ, เวอร์ชันโปรแกรม, เครื่องพิมพ์, กระดาษ, รอบถ่าย, งานพิมพ์, ยอดขาย PromptPay, งานที่ต้องตรวจ/คืนเงิน (รีเฟรชเองทุก 1 นาที)

## ทำงานอย่างไร
- โปรแกรมตัวกลางของแต่ละตู้ส่ง "สัญญาณชีพ" ทุก 1 นาทีไปที่ Edge Function `kiosk-heartbeat` (ใช้ credential ของตู้) เก็บสถานะล่าสุดในตาราง `kiosk_status`
- หน้าเว็บล็อกอินด้วย Supabase Auth (อีเมล+รหัสผ่าน) แล้วเรียกฟังก์ชัน `dashboard_overview()` ซึ่งคืนเฉพาะตู้ของ workspace ที่ผู้ล็อกอินเป็นสมาชิก (`workspace_members`) ไม่มีตารางไหนเปิดอ่านด้วย anon key
- ออนไลน์ = สัญญาณล่าสุดไม่เกิน 2.5 นาที, ช้า = ไม่เกิน 10 นาที, เกินนั้น = ขาดการติดต่อ

## ตั้งสิทธิ์เจ้าของ (ครั้งเดียว)
1. Supabase Dashboard → Authentication → Users → Add user → Create new user: ใส่อีเมลของคุณ + รหัสผ่านที่ตั้งเอง และติ๊ก **Auto Confirm User**
2. เพิ่มเป็นสมาชิก (SQL Editor):
   ```sql
   insert into public.workspace_members (workspace_id, user_id, member_role)
   select w.id, u.id, 'owner' from public.workspaces w, auth.users u
   where u.email = 'อีเมลของคุณ' order by w.created_at limit 1;
   ```
3. แนะนำ: Authentication → Sign In / Providers → ปิด "Allow new users to sign up" (ไม่มีใครสมัครบัญชีเพิ่ม)

## ใช้งาน
เปิด `https://<โดเมนของโปรเจกต์ Vercel>/dashboard` (หรือ `/dashboard.html`) ในเครื่องหรือมือถือ ตู้ที่ยังไม่เคยส่งสัญญาณจะขึ้น "ยังไม่เคยเชื่อมต่อ" จนกว่าจะได้โปรแกรมเวอร์ชันที่มีสัญญาณชีพ (ติดตั้งตัวใหม่หนึ่งครั้ง หรืออัปเดตผ่าน `npm run publish:update`)

หน้านี้ไม่ถูกรวมในโปรแกรมของตู้ (ตัดออกตอนทำตัวติดตั้งและชุดอัปเดต)
