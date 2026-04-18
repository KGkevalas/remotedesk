/**
 * input-handler.js – Pelės ir klaviatūros valdymas
 *
 * Windows: PowerShell + .NET System.Windows.Forms (nereikia kompiliavimo)
 * Linux  : xdotool (standartinis įrankis, diegiamas su apt)
 *
 * JOKIŲ native Node.js modulių – veikia iš karto.
 */

'use strict';

const { execFile, spawn } = require('child_process');
const { screen }          = require('electron');
const os                  = require('os');

const IS_WINDOWS = os.platform() === 'win32';
const IS_LINUX   = os.platform() === 'linux';

// ─── Ekrano matmenys ──────────────────────────────────────────────────────────
function getScreenSize() {
  const p = screen.getPrimaryDisplay();
  return p.size; // { width, height }
}

function toAbsolute(relX, relY) {
  const { width, height } = getScreenSize();
  return {
    x: Math.round(Math.max(0, Math.min(1, relX)) * (width  - 1)),
    y: Math.round(Math.max(0, Math.min(1, relY)) * (height - 1)),
  };
}

// ─── Windows: PowerShell input ────────────────────────────────────────────────
function psRun(code) {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', code,
    ], { windowsHide: true });
    ps.on('close', resolve);
    ps.on('error', () => resolve()); // tyliai ignoruoti klaidas
  });
}

// PS kodas pelei judinti ir spausti
const PS_INIT = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN  = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP    = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP   = 0x0010;
  public const uint MOUSEEVENTF_WHEEL     = 0x0800;
  public const uint KEYEVENTF_KEYUP       = 0x0002;
}
"@;
`;

let psInitialized = false;

async function handleWindows(event) {
  let code = '';

  switch (event.type) {
    case 'mousemove': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      code = `${PS_INIT}[WinInput]::SetCursorPos(${x}, ${y});`;
      break;
    }
    case 'mousedown': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      const flag = event.button === 2 ? 'MOUSEEVENTF_RIGHTDOWN' : 'MOUSEEVENTF_LEFTDOWN';
      code = `${PS_INIT}[WinInput]::SetCursorPos(${x}, ${y}); [WinInput]::mouse_event([WinInput]::${flag}, 0, 0, 0, 0);`;
      break;
    }
    case 'mouseup': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      const flag = event.button === 2 ? 'MOUSEEVENTF_RIGHTUP' : 'MOUSEEVENTF_LEFTUP';
      code = `${PS_INIT}[WinInput]::SetCursorPos(${x}, ${y}); [WinInput]::mouse_event([WinInput]::${flag}, 0, 0, 0, 0);`;
      break;
    }
    case 'click': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      if (event.button === 2) {
        code = `${PS_INIT}[WinInput]::SetCursorPos(${x}, ${y}); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_RIGHTDOWN, 0,0,0,0); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_RIGHTUP, 0,0,0,0);`;
      } else {
        code = `${PS_INIT}[WinInput]::SetCursorPos(${x}, ${y}); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTDOWN, 0,0,0,0); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTUP, 0,0,0,0);`;
      }
      break;
    }
    case 'dblclick': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      code = `${PS_INIT}[WinInput]::SetCursorPos(${x}, ${y}); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTDOWN,0,0,0,0); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTUP,0,0,0,0); Start-Sleep -Milliseconds 50; [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTDOWN,0,0,0,0); [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTUP,0,0,0,0);`;
      break;
    }
    case 'scroll': {
      const delta = event.deltaY > 0 ? -120 : 120;
      code = `${PS_INIT}[WinInput]::mouse_event([WinInput]::MOUSEEVENTF_WHEEL, 0, 0, ${delta}, 0);`;
      break;
    }
    case 'keydown': {
      const vk = mapVK(event.key);
      if (!vk) return;
      code = `${PS_INIT}[WinInput]::keybd_event(${vk}, 0, 0, 0);`;
      break;
    }
    case 'keyup': {
      const vk = mapVK(event.key);
      if (!vk) return;
      code = `${PS_INIT}[WinInput]::keybd_event(${vk}, 0, [WinInput]::KEYEVENTF_KEYUP, 0);`;
      break;
    }
    case 'type': {
      if (!event.text) return;
      const safe = event.text.replace(/'/g, "''");
      code = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safe}');`;
      break;
    }
    default: return;
  }

  if (code) await psRun(code);
}

// ─── Linux: xdotool ───────────────────────────────────────────────────────────
function xdo(args) {
  return new Promise((resolve) => {
    execFile('xdotool', args, { timeout: 500 }, () => resolve());
  });
}

async function handleLinux(event) {
  switch (event.type) {
    case 'mousemove': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      await xdo(['mousemove', String(x), String(y)]);
      break;
    }
    case 'mousedown': {
      const btn = event.button === 2 ? '3' : '1';
      await xdo(['mousedown', btn]);
      break;
    }
    case 'mouseup': {
      const btn = event.button === 2 ? '3' : '1';
      await xdo(['mouseup', btn]);
      break;
    }
    case 'click': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      const btn = event.button === 2 ? '3' : '1';
      await xdo(['mousemove', String(x), String(y)]);
      await xdo(['click', btn]);
      break;
    }
    case 'dblclick': {
      const { x, y } = toAbsolute(event.relX, event.relY);
      await xdo(['mousemove', String(x), String(y)]);
      await xdo(['click', '--repeat', '2', '1']);
      break;
    }
    case 'scroll': {
      const btn = event.deltaY > 0 ? '5' : '4';
      await xdo(['click', '--repeat', '3', btn]);
      break;
    }
    case 'keydown': {
      const key = mapXdoKey(event.key);
      if (key) await xdo(['keydown', key]);
      break;
    }
    case 'keyup': {
      const key = mapXdoKey(event.key);
      if (key) await xdo(['keyup', key]);
      break;
    }
    case 'type': {
      if (event.text) await xdo(['type', '--clearmodifiers', '--', event.text]);
      break;
    }
  }
}

// ─── Pagrindinė funkcija ──────────────────────────────────────────────────────
async function handleInputEvent(event) {
  try {
    if (IS_WINDOWS)     await handleWindows(event);
    else if (IS_LINUX)  await handleLinux(event);
  } catch (err) {
    // Tyliai ignoruoti – nesustabdyti programos dėl input klaidos
    console.error('[input]', err.message);
  }
}

// ─── Virtual-Key kodai (Windows) ─────────────────────────────────────────────
function mapVK(key) {
  const map = {
    'Backspace':0x08,'Tab':0x09,'Enter':0x0D,'Shift':0x10,'Control':0x11,
    'Alt':0x12,'Escape':0x1B,'Space':0x20,' ':0x20,
    'PageUp':0x21,'PageDown':0x22,'End':0x23,'Home':0x24,
    'ArrowLeft':0x25,'ArrowUp':0x26,'ArrowRight':0x27,'ArrowDown':0x28,
    'Delete':0x2E,'Insert':0x2D,
    'F1':0x70,'F2':0x71,'F3':0x72,'F4':0x73,'F5':0x74,'F6':0x75,
    'F7':0x76,'F8':0x77,'F9':0x78,'F10':0x79,'F11':0x7A,'F12':0x7B,
    'Meta':0x5B,'ContextMenu':0x5D,
    'CapsLock':0x14,'NumLock':0x90,'ScrollLock':0x91,
    'a':0x41,'b':0x42,'c':0x43,'d':0x44,'e':0x45,'f':0x46,'g':0x47,
    'h':0x48,'i':0x49,'j':0x4A,'k':0x4B,'l':0x4C,'m':0x4D,'n':0x4E,
    'o':0x4F,'p':0x50,'q':0x51,'r':0x52,'s':0x53,'t':0x54,'u':0x55,
    'v':0x56,'w':0x57,'x':0x58,'y':0x59,'z':0x5A,
    '0':0x30,'1':0x31,'2':0x32,'3':0x33,'4':0x34,
    '5':0x35,'6':0x36,'7':0x37,'8':0x38,'9':0x39,
  };
  const k = key.length === 1 ? key.toLowerCase() : key;
  return map[k] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : null);
}

// ─── xdotool klavišų pavadinimai ─────────────────────────────────────────────
function mapXdoKey(key) {
  const map = {
    'Enter':'Return','Backspace':'BackSpace','Tab':'Tab','Escape':'Escape',
    'Delete':'Delete','Insert':'Insert','Home':'Home','End':'End',
    'PageUp':'Page_Up','PageDown':'Page_Down',
    'ArrowUp':'Up','ArrowDown':'Down','ArrowLeft':'Left','ArrowRight':'Right',
    'Control':'ctrl','Alt':'alt','Shift':'shift','Meta':'super',' ':'space',
    'F1':'F1','F2':'F2','F3':'F3','F4':'F4','F5':'F5','F6':'F6',
    'F7':'F7','F8':'F8','F9':'F9','F10':'F10','F11':'F11','F12':'F12',
    'CapsLock':'Caps_Lock',
  };
  return map[key] || (key.length === 1 ? key : null);
}

module.exports = { handleInputEvent, toAbsolute };
