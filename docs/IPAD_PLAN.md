# แผนใช้งานตู้ Photobooth บน iPad (ทุกฟังก์ชัน + พิมพ์ตรงจากแอป)

สถานะ: แผน (ยังไม่เริ่มเขียนโค้ด) · 2026-10-27

## สรุปสั้น

- **ทำได้ และควรรวมเป็นระบบเดียวกัน** แบบเดียวกับที่ทำ Android: หน้าเว็บชุดเดิมทุกหน้า + แอป iPad ตัวกลาง (native) ที่ให้ `window.PhotoboothDevice` / `PhotoboothPrinter` และ `/api/*` ชุดเดียวกับ Windows/Android หน้าเว็บแทบไม่ต้องแก้
- **พิมพ์ตรงจากแอปโดยไม่ขึ้นหน้าต่างพิมพ์ของ iPad ทำได้** แต่ต้องเลือกเครื่องพิมพ์ให้ถูก เพราะ iPad ไม่ยอมให้แอปต่อ Bluetooth แบบธรรมดา (Classic/SPP) กับเครื่องพิมพ์ทั่วไป:
  - ✅ เครื่องพิมพ์ใบเสร็จแบบ **LAN / Wi-Fi** (ESC/POS พอร์ต 9100) — ทางที่แนะนำที่สุด, ใช้โค้ดแบบเดียวกับ Android ได้เลย, รวมถึง **AIMO QF300 รุ่น USB+LAN**
  - ✅ เครื่องพิมพ์ **Bluetooth ที่ได้รับรอง MFi** (เช่น Epson TM-m30III, Star mC-Print3) ผ่าน SDK ของยี่ห้อ
  - ⚠️ เครื่องพิมพ์ **Bluetooth LE (BLE)** ราคาถูกบางรุ่น — ได้ แต่ช้าและต่างกันไปแต่ละรุ่น
  - ✅ เครื่องพิมพ์ภาพ **Canon SELPHY CP1500** ผ่าน AirPrint แบบเงียบ (เลือกเครื่องครั้งเดียว ต่อไปพิมพ์ไม่ถามอีก)
  - ❌ **AIMO QF300 รุ่น Bluetooth ที่ใช้อยู่ ใช้กับ iPad ผ่าน Bluetooth ไม่ได้** (เป็น Bluetooth Classic ไม่มี MFi) — ใช้ต่อกับ Android ได้ตามเดิม
- **ข้อจำกัดใหญ่ของ iPad เทียบกับ Android**: ต้องมีบัญชี Apple Developer (~$99/ปี), ต้อง build บน Mac (หรือ Mac บนคลาวด์ เช่น GitHub Actions), ติดตั้งผ่าน TestFlight / App Store แทนการส่งไฟล์ APK, และอัปเดตแอปผ่าน Apple แทนช่อง canary/stable ของเราเอง

## 1. ทางเลือกหลัก

| ทางเลือก | ทุกฟังก์ชัน | พิมพ์ตรงไม่มีหน้าต่าง | ข้อเสีย |
|---|---|---|---|
| **A. เปิดหน้าเว็บใน Safari / Add to Home Screen** | ✗ ไม่มีตัวกลาง จึงใช้ Redeem/สิทธิ์พิมพ์/แอดมินจริงไม่ได้ (credential ห้ามอยู่ในหน้าเว็บ) | ✗ Safari พิมพ์ได้แค่ผ่านหน้าต่าง AirPrint; ไม่มี Web Bluetooth / WebUSB | ใช้ได้แค่เดโม |
| **B. แอป iPad (Swift + WKWebView) ตัวกลางแบบเดียวกับ Android** ⭐ แนะนำ | ✓ | ✓ (LAN, MFi, BLE, AirPrint เงียบ) | ต้องมี Mac/คลาวด์ Mac + บัญชี Apple Developer |
| C. เขียนแอปใหม่ทั้งหมด (Flutter/React Native) | ✓ | ✓ | ต้องเขียนหน้าจอใหม่ทุกหน้า แยกจากระบบเดิม — ไม่คุ้ม |

**เลือก B** — เหตุผลเดียวกับ Android: หน้าเว็บชุดเดียว, ตรรกะสิทธิ์พิมพ์/กันพิมพ์ซ้ำเหมือนเดิมทุกเครื่อง, มีเทสต์ตรวจว่าเมธอดตรงกันทุกแพลตฟอร์ม

## 2. สถาปัตยกรรมแอป iPad

```
หน้าเว็บ (dist-next ชุดเดียวกัน)
  ├─ Windows: Chrome → localhost:8787 → agent/server.mjs → Windows spooler
  ├─ Android: WebView → appassets.androidplatform.net → Kiosk.kt → Bluetooth / TCP 9100
  └─ iPad:    WKWebView → http://localhost:<port> (เสิร์ฟไฟล์ในแอป) → Kiosk.swift → TCP 9100 / MFi / BLE / AirPrint
                         ↘ ทุกตัวเรียก Supabase Edge Functions ชุดเดียวกัน (credential อยู่ในตัวกลางเท่านั้น)
```

- **เสิร์ฟหน้าเว็บจาก `http://localhost`** ภายในแอป (เซิร์ฟเวอร์เล็กด้วย Network.framework) ไม่ใช้ custom scheme เพราะมีรายงานว่ากล้อง (`getUserMedia`) ใน WKWebView ใช้ไม่ได้กับบาง custom scheme; `localhost` ถือเป็น secure context แน่นอน ทำให้กล้อง, Web Worker และ module worker ทำงานได้
- **คำสั่ง bridge ส่งผ่าน `WKScriptMessageHandlerWithReply`** (ไม่ผ่านเครือข่าย, ตรวจ origin ได้) ใช้ `android/web/bridge-shim.js` ตัวเดิมโดยเพิ่มตัวแปลงเล็ก ๆ ให้ `window.PBNative.postMessage` เรียก `webkit.messageHandlers` แทน — สคริปต์ฝั่งหน้าเว็บจึงเป็นตัวเดียวกับ Windows/Android
- **พอร์ตจาก Android/Windows เป็น Swift** (ขนาดเล็ก ~1,000 บรรทัด): `DeviceApi` (เรียก Edge Functions), `PrintService` + `PrintJournal` (บันทึกงานก่อนพิมพ์, ไม่พิมพ์ซ้ำ, retry รายงาน), `EscPos` (dither + raster + ลบรหัสสั่งงานที่ซ่อนในรูป + ส่งเป็นช่วงรอยืนยัน), setup page, heartbeat
- **credential เก็บใน Keychain** (เทียบ DPAPI/Keystore)
- **กันโค้ดหลุดกัน**: เพิ่มเทสต์แบบเดียวกับ `android/scripts/bridge-client.test.mjs` ตรวจว่าเมธอดใน Swift ตรงกับ `bridge/core.mjs` และใช้ "ชุดข้อมูลทดสอบกลาง" (ภาพเล็ก → ไบต์ ESC/POS ที่ต้องได้) ร่วมกันทั้ง Kotlin/Swift
  - ทางเลือกเสริมภายหลัง: Kotlin Multiplatform แชร์โค้ด `EscPos`/`PrintService`/`DeviceApi` ตัวเดียวทั้ง Android+iOS (ลดการดูแลสองชุด แต่ตั้งระบบยากขึ้น) — ยังไม่แนะนำในรอบแรก

## 3. การพิมพ์ตรงจากแอป (รายละเอียด)

| ช่องทาง | เครื่องที่ใช้ได้ | วิธีในแอป | หมายเหตุ |
|---|---|---|---|
| **LAN/Wi-Fi ESC/POS (แนะนำ)** | AIMO QF300 **USB+LAN**, Xprinter/Epson/Star รุ่น LAN/Wi-Fi ทั่วไป | TCP พอร์ต 9100 ด้วย Network.framework ส่งไบต์ ESC/POS ชุดเดียวกับ Android (ส่งเป็นช่วง + ถามสถานะยืนยัน, ตรวจกระดาษหมดก่อนพิมพ์) | ต้องตั้ง IP เครื่องพิมพ์แบบคงที่, iPad กับเครื่องพิมพ์อยู่วง Wi-Fi เดียวกัน, ขอสิทธิ์ "Local Network" ครั้งแรก |
| **Bluetooth MFi** | Epson TM-m30III (Bluetooth/Wi-Fi), Star mC-Print3 (รุ่น Lightning/MFi) | SDK ของยี่ห้อ (Epson ePOS SDK, Star StarXpand/StarIO10) ผ่าน External Accessory | เครื่องราคาสูงกว่า, ต้องประกาศ protocol ของยี่ห้อในแอป, ต้องเช็กรุ่นย่อยว่ารองรับ MFi จริง (เช่น mC-Print3 รุ่น USB-C บางสเปกไม่รองรับ MFi) |
| **Bluetooth LE** | เครื่องพกพา 58 มม. บางรุ่นที่มี BLE (บริการ 18F0/FFE0 ฯลฯ) | CoreBluetooth เขียน ESC/POS ทีละก้อนเล็ก | ช้า (รูปใบยาวอาจหลายสิบวินาที), แต่ละรุ่นต่างกัน ต้องทดสอบทีละรุ่น |
| **AirPrint เงียบ** | Canon SELPHY CP1500 และเครื่องพิมพ์ภาพ/เอกสารที่รองรับ AirPrint | เลือกเครื่องครั้งเดียวในแอดมิน (`UIPrinterPickerController`) แล้วพิมพ์ด้วย `print(to:)` ไม่มีหน้าต่าง | SELPHY ต้องอยู่ Wi-Fi 2.4 GHz วงเดียวกับ iPad; ทดสอบบน iPadOS ที่ใช้จริงเพราะมีรายงานบั๊กบางเวอร์ชัน |
| ❌ Bluetooth Classic ทั่วไป | AIMO QF300 BT, MTP-II, PT-210 ฯลฯ | iOS ไม่อนุญาต | ใช้กับ Android ได้ |

**คำแนะนำซื้อ/ใช้เครื่องพิมพ์สำหรับ iPad**: ถ้าใช้ AIMO QF300 อยู่แล้ว → ใช้ **รุ่น USB+LAN** ต่อสาย LAN เข้าเราเตอร์ (หรือเราเตอร์พกพา) ได้ผลเหมือน Android ทุกอย่าง และ Android ก็พิมพ์ผ่าน LAN ได้ด้วย (`192.168.x.x:9100` มีในแอป Android แล้ว) จึงใช้เครื่องพิมพ์เดียวกันได้ทุกแพลตฟอร์ม

## 4. ฟังก์ชันอื่นบน iPad

| ฟังก์ชัน | วิธี | สถานะ |
|---|---|---|
| กล้องถ่ายรูป | `getUserMedia` ใน WKWebView (iOS 14.3+) + อนุญาตอัตโนมัติผ่าน `requestMediaCapturePermission` (iPadOS 15+) + ข้อความขอสิทธิ์กล้องใน Info.plist | ได้ |
| ฟิลเตอร์รูป (ขาวดำ, วินเทจ, สดใส ฯลฯ) | **ต้องแก้หน้าเว็บ**: `public/shared.js` ใช้ `ctx.filter` ซึ่ง Safari/WKWebView ยังไม่เปิดให้ใช้ (iOS 18 ถึง 26.x ยังปิดเป็นค่าเริ่มต้น) → รูปจะไม่ติดฟิลเตอร์ ต้องเปลี่ยนเป็นปรับพิกเซลเอง (ใช้ได้ทุกเบราว์เซอร์) | ต้องแก้ |
| GIF | ใช้ `OffscreenCanvas` ใน worker → ต้อง iPadOS 16.4 ขึ้นไป | ได้ (กำหนดขั้นต่ำ) |
| เลนส์ / Look (WebGL) | WebGL บน iPad | ได้ (ทดสอบความลื่นบนรุ่นจริง) |
| QR ดาวน์โหลด, Redeem, PromptPay, แอดมิน, ธีม | ผ่าน bridge เหมือน Android | ได้ |
| อัปโหลดไฟล์ในแอดมิน | `<input type=file>` ใช้ได้ใน WKWebView | ได้ |
| ดาวน์โหลดไฟล์ในแอดมิน (template editor) | ต้องรองรับ `WKDownloadDelegate` (iPadOS 14.5+) | ทำเพิ่มในแอป |
| หน้าจอไม่ดับ | `isIdleTimerDisabled = true` ในแอป | ได้ |
| Heartbeat → Dashboard | เหมือน Android | ได้ |
| ล็อกให้อยู่ในแอป | **Guided Access** (มีในเครื่อง, ไม่ต้องใช้อะไรเพิ่ม แต่หลุดเมื่อรีสตาร์ท) หรือ **Single App Mode** ผ่าน Apple Configurator/MDM (ต้องตั้งเครื่องเป็น supervised, อยู่ถาวรแม้รีสตาร์ท) | เลือกตามจำนวนเครื่อง |

**iPad ที่แนะนำ**: iPadOS 17 ขึ้นไป (ขั้นต่ำ 16.4), RAM 4 GB+, กล้องหน้า 12MP (iPad รุ่นที่ 10 ขึ้นไป / iPad Air)

## 5. Build, ติดตั้ง, อัปเดต

- **บัญชี Apple Developer Program** ~US$99/ปี (ชำระเป็นเงินบาท) — จำเป็นสำหรับ TestFlight/App Store/Ad Hoc
- **ที่ build**: เครื่องนี้เป็น Windows → ใช้ **GitHub Actions macOS runner** (มีอยู่แล้วใน GitHub) build + เซ็น + อัปโหลด TestFlight อัตโนมัติ หรือยืม/เช่า Mac / Xcode Cloud / Codemagic ถ้าต้อง debug ละเอียดต้องมี Mac
- **ติดตั้งเพื่อทดสอบ**: **TestFlight** — คุณติดตั้งแอป TestFlight บน iPad แล้วรับลิงก์เชิญ (ทดสอบภายในได้ทันทีหลังอัปโหลด, แต่ละ build ใช้ได้ 90 วัน)
- **ใช้งานจริง**: App Store แบบ **Unlisted** (ไม่ขึ้นค้นหา เข้าผ่านลิงก์) หรือ Custom App ผ่าน Apple Business Manager; หรือ Ad Hoc (ลงทะเบียน UDID ได้ 100 เครื่อง/ปี)
- **อัปเดต**: อัปเดตอัตโนมัติผ่าน App Store/TestFlight (iPad ติดตั้งเองตอนว่าง) แทนช่อง canary/stable — ใช้ **TestFlight = ช่องทดลอง**, **App Store = ช่องปกติ**; การดาวน์โหลดโค้ดหน้าเว็บมาเปลี่ยนเองแบบ Windows เสี่ยงผิดกฎ App Store 2.5.2 จึงไม่แนะนำ
- Apple ตรวจแอปก่อนขึ้น App Store (ปกติ 1–3 วัน) — ต้องเตรียมบัญชีทดสอบ/คำอธิบายว่าเป็นแอปตู้ถ่ายรูปของร้าน

## 6. แผนทำงานเป็นขั้น

| ขั้น | งาน | ต้องการจากคุณ | ทดสอบได้บน |
|---|---|---|---|
| 0 | ตัดสินใจ: เครื่องพิมพ์ใบเสร็จสำหรับ iPad (แนะนำ QF300 USB+LAN), ใช้ SELPHY ด้วยไหม, รุ่น iPad, สมัคร Apple Developer | สมัครบัญชี, ซื้อ/ยืมเครื่องพิมพ์ LAN | — |
| 1 | **แก้หน้าเว็บให้ใช้กับ Safari ได้**: ฟิลเตอร์แบบปรับพิกเซลแทน `ctx.filter`; ตรวจทุกหน้าด้วยเบราว์เซอร์ WebKit (Playwright WebKit รันบน Windows ได้) | — | Windows (WebKit) + ตู้เดิมทุกเครื่องได้ประโยชน์ |
| 2 | **โครงแอป iPad**: WKWebView + localhost server + bridge (พอร์ต DeviceApi/PrintService/Journal) + หน้าตั้งค่า + Keychain + กล้อง + heartbeat + ไม่ให้จอดับ | — | TestFlight |
| 3 | **พิมพ์ LAN ESC/POS** (TCP 9100, ส่งเป็นช่วง + ยืนยัน, ตรวจกระดาษ) | QF300 LAN หรือเครื่อง LAN อื่น | iPad จริง |
| 4 | **AirPrint เงียบ** สำหรับ SELPHY/เครื่องพิมพ์ภาพ + หน้าเลือกเครื่องในแอดมิน | SELPHY (ถ้าใช้) | iPad จริง |
| 5 | (เลือกได้) Bluetooth MFi ผ่าน SDK Epson/Star หรือ BLE | เครื่องพิมพ์รุ่นนั้น | iPad จริง |
| 6 | **CI**: GitHub Actions macOS → เซ็น → TestFlight อัตโนมัติ (`npm run ios:publish`) | Apple Developer + API key | — |
| 7 | เช็กลิสต์ทดสอบ (ชุดเดียวกับ Android: สิทธิ์ไม่ถูกตัดเมื่อพิมพ์ไม่สำเร็จ, ไม่พิมพ์ซ้ำ ฯลฯ) → ขึ้น App Store แบบ Unlisted → ล็อก Guided Access/Single App Mode | ทดสอบหน้าร้าน | iPad จริง |

ขั้น 1 เริ่มได้ทันทีบนเครื่องนี้ (ไม่ต้องรอ Mac/บัญชี Apple) และเป็นประโยชน์กับลูกค้าที่เปิดสตูดิโอบน iPhone ด้วย

## 7. ความเสี่ยงที่ต้องทดสอบให้ชัดก่อนลงทุนเต็ม

- กล้องใน WKWebView บนรุ่น iPad ที่จะใช้จริง (ความละเอียด, กล้องหน้า/หลัง, การหมุนจอ)
- ความเร็วสร้างภาพ/GIF/เลนส์บน iPad (หน่วยความจำ WKWebView จำกัดกว่า Chrome)
- AirPrint เงียบกับ SELPHY บน iPadOS เวอร์ชันที่ใช้ (มีรายงานบั๊ก `print(to:)` บางเวอร์ชัน)
- เครื่องพิมพ์ LAN ตอบสถานะ (DLE EOT) หรือไม่ (ถ้าไม่ตอบ แอปจะส่งช้าลงแทน)
- การรีวิวของ App Store สำหรับแอปตู้ (ถ้าไม่ผ่าน ใช้ Ad Hoc/Custom App แทน)

## แหล่งข้อมูล

- เครื่องพิมพ์ Bluetooth Classic บน iOS ต้องเป็น MFi: [thermal_printer (pub.dev)](https://pub.dev/documentation/thermal_printer/latest/), [blue_thermal_plus (pub.dev)](https://pub.dev/documentation/blue_thermal_plus/0.1.1/), [Star Micronics Bluetooth/MFi](https://www.labelandnarrowweb.com/contents/view_breaking-news/2014-12-18/star-micronics-offers-bluetooth-range-of-pos-printers/)
- AIMO QF300 (ESC/POS, USB+BT/LAN/Serial, บัฟเฟอร์ 96 KB): [aimotech.com](https://www.aimotech.com/product/qf300-pos-printer/)
- Star mC-Print3 / StarXpand SDK: [GitHub StarXpand-SDK-iOS](https://github.com/star-micronics/StarXpand-SDK-iOS/), [spec sheet](https://www.thegeneralstore.com/wp-content/uploads/2022/01/Star-mC-print3_spec-sheet-07-08-2020-Digital.pdf)
- Epson TM-m30III กับ iPad: [Shopify Help](https://help.shopify.com/en/manual/sell-in-person/hardware/receipt-printers/epsontmm30iii?locale=fr), [Lightspeed](https://retail-support.lightspeedhq.com/hc/articles/360045854854)
- BLE printer บน iOS: [B4X forum](https://www.b4x.com/android/forum/threads/solved-printing-with-ble.144348/), [Apple forum: CoreBluetooth image printing slow](https://developer.apple.com/forums/thread/105110)
- AirPrint เงียบ (`print(to:)`): [Apple Developer Forums 671361](https://developer.apple.com/forums/thread/671361), [Forum 739841](https://developer.apple.com/forums/thread/739841)
- Canon SELPHY CP1500 AirPrint: [Canon manual](https://cam.start.canon/en/P001/manual/html/UG-03_Print_Wi-Fi_0030.html), [Canon USA](https://www.usa.canon.com/shop/p/selphy-cp1500)
- กล้องใน WKWebView / custom scheme: [WebKit bug 220184](https://bugs.webkit.org/show_bug.cgi?id=220184), [WebKit bug 259304](https://onbugs.webkit.org/show_bug.cgi?id=259304)
- `ctx.filter` ใน Safari: [caniuse](https://caniuse.com/mdn-api_canvasrenderingcontext2d_filter), [WebKit bug 198416](https://bugs.webkit.org/show_bug.cgi?id=198416)
- OffscreenCanvas ใน Safari 16.4: [web.dev](https://web.dev/articles/offscreen-canvas), [WebKit bug 253431](https://www2.webkit.org/show_bug.cgi?id=253431)
- Build iOS โดยไม่มี Mac: [capawesome](https://capawesome.io/blog/how-to-build-and-deploy-ios-apps-without-a-mac/), [Apple forum 815497](https://developer.apple.com/forums/thread/815497)
- Kiosk iPad: [Hexnode: Single App Mode vs ASAM vs Guided Access](https://www.hexnode.com/blogs/single-app-mode-vs-autonomous-single-app-mode-vs-guided-access-mode-vs-automatic-assessment-configuration/)
- กฎ App Store 2.5.2: [ptkd.com](https://ptkd.com/journal/guideline-2-5-2-downloading-scripts-without-review)
