# ============================================================
#  RemoteDesk – Windows Instaliacijos Skriptas
#  Paleidimas: Dešiniuoju pelės klavišu -> "Run with PowerShell"
#  arba: powershell -ExecutionPolicy Bypass -File install-windows.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$AppName    = "RemoteDesk"
$AppVersion = "1.0.0"
$InstallDir = "$env:LOCALAPPDATA\RemoteDesk"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path

# ─── Spalvoti pranešimai ──────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "`n[KLAIDA] $msg" -ForegroundColor Red }

Clear-Host
Write-Host @"

  ██████╗ ███████╗███╗   ███╗ ██████╗ ████████╗███████╗██████╗ ███████╗███████╗██╗  ██╗
  ██╔══██╗██╔════╝████╗ ████║██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗██╔════╝██╔════╝██║ ██╔╝
  ██████╔╝█████╗  ██╔████╔██║██║   ██║   ██║   █████╗  ██║  ██║█████╗  ███████╗█████╔╝
  ██╔══██╗██╔══╝  ██║╚██╔╝██║██║   ██║   ██║   ██╔══╝  ██║  ██║██╔══╝  ╚════██║██╔═██╗
  ██║  ██║███████╗██║ ╚═╝ ██║╚██████╔╝   ██║   ███████╗██████╔╝███████╗███████║██║  ██╗
  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚══════╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
                              v$AppVersion – Nuotolinio valdymo programa

"@ -ForegroundColor Blue

Write-Host "  Instaliuojama į: $InstallDir" -ForegroundColor Gray
Write-Host "  Spauskite ENTER tęsti arba Ctrl+C atšaukti..." -ForegroundColor Gray
Read-Host | Out-Null

# ─── 1. Administratoriaus teisės ─────────────────────────────────────────────
Write-Step "Tikrinamos teisės..."
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "Paleiskite skriptą kaip Administratorius geresniam Input valdymui"
    Write-Warn "Tęsiama be administratoriaus teisių..."
}

# ─── 2. Node.js patikrinimas / diegimas ──────────────────────────────────────
Write-Step "Tikrinamas Node.js..."

$nodeOk = $false
try {
    $nodeVer = (node -v 2>$null)
    if ($nodeVer -match "v(\d+)") {
        $major = [int]$Matches[1]
        if ($major -ge 18) {
            Write-OK "Node.js $nodeVer jau įdiegtas"
            $nodeOk = $true
        } else {
            Write-Warn "Node.js $nodeVer per sena versija (reikia >= 18)"
        }
    }
} catch {}

if (-not $nodeOk) {
    Write-Step "Diegiamas Node.js v20 LTS..."

    # Bandome per winget (Windows 11 / atnaujintas W10)
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Naudojamas winget..." -ForegroundColor Gray
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -h
    } else {
        # Atsisiuntimas iš nodejs.org
        Write-Host "  Atsiunčiamas Node.js MSI..." -ForegroundColor Gray
        $nodeMsi = "$env:TEMP\node-v20-x64.msi"
        $nodeUrl = "https://nodejs.org/dist/v20.15.0/node-v20.15.0-x64.msi"

        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($nodeUrl, $nodeMsi)

        Write-Host "  Instaliuojamas Node.js (gali užtrukti)..." -ForegroundColor Gray
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /norestart" -Wait

        # Atnaujinti PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    }

    # Patikrinti
    try {
        $nodeVer = (node -v)
        Write-OK "Node.js $nodeVer įdiegtas sėkmingai"
    } catch {
        Write-Fail "Node.js įdiegimas nepavyko. Įdiekite rankiniu būdu: https://nodejs.org"
        Read-Host "Spauskite ENTER išeiti"
        exit 1
    }
}

# ─── 3. Sukurti diegimo direktoriją ──────────────────────────────────────────
Write-Step "Kuriama diegimo direktorija..."
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Write-OK "Direktorija: $InstallDir"

# ─── 4. Kopijuoti programos failus ───────────────────────────────────────────
Write-Step "Kopijuojami programos failai..."

$clientDir = Join-Path $ScriptDir "client"
if (-not (Test-Path $clientDir)) {
    Write-Fail "Nerasta 'client' direktorija šalia instaliatoriaus! Patikrinkite archyvo struktūrą."
    Read-Host "Spauskite ENTER išeiti"
    exit 1
}

# Kopijuoti visus failus
$excludes = @("node_modules", "dist", ".git")
Get-ChildItem $clientDir -Recurse | Where-Object {
    $path = $_.FullName
    $skip = $false
    foreach ($ex in $excludes) {
        if ($path -like "*\$ex\*" -or $path -like "*\$ex") { $skip = $true; break }
    }
    -not $skip
} | ForEach-Object {
    $dest = $_.FullName.Replace($clientDir, $InstallDir)
    if ($_.PSIsContainer) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
    } else {
        Copy-Item $_.FullName $dest -Force
    }
}

Write-OK "Failai nukopijuoti"

# ─── 5. npm install ──────────────────────────────────────────────────────────
Write-Step "Diegiamos priklausomybės (npm install)..."
Write-Host "  Tai gali užtrukti 2-5 minutes..." -ForegroundColor Gray

Set-Location $InstallDir

try {
    $npmOut = npm install --production 2>&1
    Write-OK "npm install baigtas"
} catch {
    Write-Warn "npm install klaida: $_"
    Write-Warn "Bandoma be native modulių..."
    npm install --ignore-scripts 2>&1 | Out-Null
}

# ─── 6. Sukurti paleidimo failus ─────────────────────────────────────────────
Write-Step "Kuriami paleidimo failai..."

# start.bat
$startBat = @"
@echo off
title RemoteDesk
cd /d "%LOCALAPPDATA%\RemoteDesk"
npx electron .
pause
"@
Set-Content "$InstallDir\start.bat" $startBat -Encoding UTF8

# start.vbs (tyliajam paleidimui – be juodo cmd lango)
$startVbs = @"
Set WShell = CreateObject("WScript.Shell")
WShell.Run "cmd /c cd /d ""%LOCALAPPDATA%\RemoteDesk"" && npx electron .", 0, False
"@
Set-Content "$InstallDir\start.vbs" $startVbs -Encoding UTF8

Write-OK "Paleidimo failai sukurti"

# ─── 7. Desktop nuoroda ───────────────────────────────────────────────────────
Write-Step "Kuriama nuoroda darbalaukyje..."

$WshShell  = New-Object -ComObject WScript.Shell
$Shortcut  = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\RemoteDesk.lnk")
$Shortcut.TargetPath       = "wscript.exe"
$Shortcut.Arguments        = "`"$InstallDir\start.vbs`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description      = "RemoteDesk – nuotolinio valdymo programa"
$Shortcut.IconLocation     = "shell32.dll,22"
$Shortcut.Save()

Write-OK "Darbalaukio nuoroda sukurta"

# ─── 8. Start Menu nuoroda ───────────────────────────────────────────────────
$StartMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\RemoteDesk"
New-Item -ItemType Directory -Path $StartMenu -Force | Out-Null

$Shortcut2 = $WshShell.CreateShortcut("$StartMenu\RemoteDesk.lnk")
$Shortcut2.TargetPath       = "wscript.exe"
$Shortcut2.Arguments        = "`"$InstallDir\start.vbs`""
$Shortcut2.WorkingDirectory = $InstallDir
$Shortcut2.Description      = "RemoteDesk"
$Shortcut2.IconLocation     = "shell32.dll,22"
$Shortcut2.Save()

Write-OK "Start Menu įrašas sukurtas"

# ─── 9. Pasirinktinai: paleisti su Windows ───────────────────────────────────
Write-Host ""
$autostart = Read-Host "  Ar paleisti RemoteDesk automatiškai su Windows? (t/n)"
if ($autostart -eq "t" -or $autostart -eq "y") {
    $RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    Set-ItemProperty $RegPath "RemoteDesk" "wscript.exe `"$InstallDir\start.vbs`""
    Write-OK "Automatinis paleidimas sukonfigūruotas"
}

# ─── 10. Atidiegimo skriptas ──────────────────────────────────────────────────
$uninstall = @"
@echo off
echo RemoteDesk atidiegimas...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v RemoteDesk /f 2>nul
del "%USERPROFILE%\Desktop\RemoteDesk.lnk" 2>nul
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\RemoteDesk" 2>nul
rmdir /s /q "%LOCALAPPDATA%\RemoteDesk" 2>nul
echo Atidiegta sekmingai!
pause
"@
Set-Content "$InstallDir\uninstall.bat" $uninstall -Encoding UTF8

# ─── Baigta ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  =================================================" -ForegroundColor Green
Write-Host "   RemoteDesk sėkmingai įdiegta!" -ForegroundColor Green
Write-Host "   Darbalaukyje atsirado nuoroda: RemoteDesk" -ForegroundColor Green
Write-Host "  =================================================" -ForegroundColor Green
Write-Host ""

$launch = Read-Host "  Ar paleisti RemoteDesk dabar? (t/n)"
if ($launch -eq "t" -or $launch -eq "y") {
    Start-Process "wscript.exe" -ArgumentList "`"$InstallDir\start.vbs`""
}

Write-Host ""
Write-Host "  Jei kyla klausimų – žiūrėkite README.md" -ForegroundColor Gray
Read-Host "  Spauskite ENTER išeiti"
