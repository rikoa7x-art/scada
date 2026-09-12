@echo off
title Prodist Scada - Monitoring Jaringan Pipa & AI Vision
color 0b

REM Pindahkan ke direktori dimana file BAT ini berada
cd /d "%~dp0"

echo =======================================================================
echo    PRODIST SCADA - SISTEM MONITORING JARINGAN PIPA
echo =======================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js tidak ditemukan! Silakan instal dari https://nodejs.org
    pause
    exit /b 1
)

REM Periksa versi Node.js >= 18
for /f "tokens=1 delims=v." %%a in ('node -v') do (
    set NODE_MAJOR=%%a
    goto :checkver
)
:checkver
if %NODE_MAJOR% LSS 18 (
    echo [ERROR] Diperlukan Node.js versi 18 atau lebih baru! Versi terdeteksi: 
    node -v
    echo Silakan unduh dari https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Menginstal dependensi...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Gagal menginstal dependensi! Periksa koneksi internet.
        pause
        exit /b 1
    )
)

echo.
echo Menjalankan Server SCADA... Browser akan terbuka otomatis setelah siap.
echo (JANGAN TUTUP JENDELA INI SELAMA MENGGUNAKAN SCADA)
echo.
node server.js --open

pause
