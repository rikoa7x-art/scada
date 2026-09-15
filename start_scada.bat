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

REM Periksa versi Node.js >= 18 (menggunakan Node sendiri untuk parsing yang lebih akurat)
node -e "var v=parseInt(process.versions.node);if(v<18){console.error('[ERROR] Diperlukan Node.js versi 18+. Versi saat ini: '+process.versions.node);process.exit(1);}"
if errorlevel 1 (
    echo Silakan unduh Node.js 18+ dari https://nodejs.org
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
