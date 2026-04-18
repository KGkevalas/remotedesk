@echo off
title RemoteDesk
cd /d "%~dp0client"

:: Patikrinti Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [KLAIDA] Node.js nerastas!
    echo Paleiskite install-windows.ps1 pirmiausia.
    echo.
    pause
    exit /b 1
)

:: Patikrinti node_modules
if not exist "node_modules\" (
    echo [*] Pirmasis paleidimas - diegiamos priklausomybes...
    npm install
    if errorlevel 1 (
        echo [KLAIDA] npm install nepavyko!
        pause
        exit /b 1
    )
)

:: Paleisti Electron
echo [*] Paleidziama RemoteDesk...
npx electron .
