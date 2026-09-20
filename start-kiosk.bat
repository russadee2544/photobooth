@echo off
REM =============================================
REM  MEMORIES PHOTO BOOTH - Kiosk Launcher
REM  พิมพ์อัตโนมัติโดยไม่ขึ้นหน้า Print Dialog
REM =============================================
REM
REM  --kiosk-printing  = ส่งพิมพ์ตรงไปเครื่องพิมพ์ Default โดยไม่แสดง Dialog
REM  --kiosk           = เปิดเบราว์เซอร์แบบ Full-screen Kiosk
REM  --disable-pinch   = ปิด Pinch Zoom (สำหรับจอสัมผัส)
REM
REM  ⚠️  ตรวจสอบให้แน่ใจว่า:
REM    1. XP-58 ถูกตั้งเป็น Default Printer ใน Windows
REM    2. ขนาดกระดาษตั้งเป็น 58mm (ใน Printing Preferences)
REM

SET CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
SET CHROME_PATH_86="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
SET SITE_URL=http://localhost:5173/home.html

REM ตรวจหา Chrome
IF EXIST %CHROME_PATH% (
    SET BROWSER=%CHROME_PATH%
) ELSE IF EXIST %CHROME_PATH_86% (
    SET BROWSER=%CHROME_PATH_86%
) ELSE (
    echo [ERROR] ไม่พบ Google Chrome กรุณาติดตั้ง Chrome ก่อน
    echo         หรือแก้ไข CHROME_PATH ในไฟล์นี้
    pause
    exit /b 1
)

SET PROFILE_DIR="%LOCALAPPDATA%\PhotoboothKioskProfile"

echo =============================================
echo   MEMORIES PHOTO BOOTH - Silent Print Mode
echo =============================================
echo.
echo  Browser  : %BROWSER%
echo  URL      : %SITE_URL%
echo  Printer  : พิมพ์ตรงไปยังเครื่องพิมพ์ Default ใน Windows ทันที
echo  Silent   : เปิดใช้งาน (--kiosk-printing ไม่ขึ้นหน้าต่าง Print Dialog)
echo.
echo  กด Ctrl+C เพื่อหยุด หรือ Alt+F4 เพื่อปิด Kiosk
echo =============================================

%BROWSER% --user-data-dir=%PROFILE_DIR% --kiosk --kiosk-printing --disable-pinch --disable-translate --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required %SITE_URL%

