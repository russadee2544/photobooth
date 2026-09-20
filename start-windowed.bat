@echo off
REM =============================================
REM  MEMORIES PHOTO BOOTH - Windowed Silent Print
REM  เปิดเป็นหน้าต่างโปรแกรม และพิมพ์ทันทีไม่ขึ้น Print Dialog
REM =============================================

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
    pause
    exit /b 1
)

SET PROFILE_DIR="%LOCALAPPDATA%\PhotoboothKioskProfile"

echo =============================================
echo   MEMORIES PHOTO BOOTH - Windowed Mode
echo =============================================
echo  Browser  : %BROWSER%
echo  URL      : %SITE_URL%
echo  Printer  : พิมพ์ตรงไปยัง Default Printer ทันที
echo  Silent   : เปิดใช้งาน (--kiosk-printing)
echo =============================================

%BROWSER% --user-data-dir=%PROFILE_DIR% --app=%SITE_URL% --kiosk-printing --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required
