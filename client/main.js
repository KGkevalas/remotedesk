/**
 * main.js – Electron pagrindinis procesas
 *
 * Atsakingas už:
 *  • Lango kūrimą
 *  • WebSocket ryšį su relay serveriu
 *  • Ekrano fiksavimą (HOST režime)
 *  • Įvesties apdorojimą (HOST režime)
 *  • IPC ryšį su renderer procesu
 *  • Automatinį ryšio atkūrimą
 *  • Failų perdavimą
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path   = require('path');
const fs     = require('fs');
const WebSocket = require('ws');

const { startCapture }     = require('./src/capture');
const { handleInputEvent } = require('./src/input-handler');

// ─── Konfigūracija ────────────────────────────────────────────────────────────
const SERVER_URL    = process.env.SERVER_URL || 'ws://187.124.128.36:7070';
const RECONNECT_MS  = 3000;   // automatinis perjungimas po X ms
const MAX_RECONNECT = 20;     // max bandymų skaičius

// ─── Globalios būsenos ────────────────────────────────────────────────────────
let mainWindow = null;
let ws         = null;
let captureCtrl= null;    // { stop(), setQuality(), setScale() }
let role       = null;    // 'host' | 'viewer'
let myId       = null;    // host ID (jei esame host)
let reconnectAttempts = 0;
let reconnectTimer    = null;
let isConnectedToRelay= false;

// ─── Lango kūrimas ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width           : 960,
    height          : 680,
    minWidth        : 700,
    minHeight       : 500,
    title           : 'RemoteDesk',
    backgroundColor : '#1a1a2e',
    webPreferences  : {
      preload         : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration : false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Atidaryti DevTools debug'ui (pašalinti release versijoje)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

// ─── WebSocket jungtis ────────────────────────────────────────────────────────
function connectToRelay() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  console.log(`[ws] Jungiamasi prie ${SERVER_URL} (bandymas ${reconnectAttempts + 1})`);

  ws = new WebSocket(SERVER_URL, {
    handshakeTimeout: 5000,
  });

  ws.on('open', () => {
    isConnectedToRelay = true;
    reconnectAttempts  = 0;
    console.log('[ws] Relay serveris: prisijungta');
    sendToRenderer('relay-status', { connected: true, url: SERVER_URL });
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleServerMessage(msg);
  });

  ws.on('close', (code, reason) => {
    isConnectedToRelay = false;
    console.log(`[ws] Jungtis nutraukta: ${code}`);
    sendToRenderer('relay-status', { connected: false });
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[ws] Klaida:', err.message);
    sendToRenderer('error', { message: `Serverio klaida: ${err.message}` });
  });
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    sendToRenderer('error', { message: 'Nepavyko prisijungti prie serverio po daugelio bandymų.' });
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectAttempts++;
    connectToRelay();
  }, RECONNECT_MS);
}

function sendWS(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ─── Serverio pranešimų apdorojimas ──────────────────────────────────────────
async function handleServerMessage(msg) {
  switch (msg.type) {

    // ── HOST: sėkmingai užregistruotas ──────────────────────────────────────
    case 'registered':
      myId = msg.id;
      role = 'host';
      sendToRenderer('registered', { id: msg.id });
      console.log(`[host] Mano ID: ${msg.id}`);
      break;

    // ── HOST: viewer prisijungė ──────────────────────────────────────────────
    case 'viewer_connected':
      sendToRenderer('viewer-connected', { viewerId: msg.viewerId });
      console.log(`[host] Viewer prisijungė: ${msg.viewerId}`);
      startScreenStream();
      break;

    // ── HOST: viewer atsijungė ───────────────────────────────────────────────
    case 'viewer_disconnected':
      sendToRenderer('viewer-disconnected', { viewerId: msg.viewerId });
      // Sustabdome fiksavimą jei nėra daugiau viewers
      // (serveris gali pranešti kai visiškai tuščia)
      break;

    // ── VIEWER: sėkmingai prisijungė prie host ───────────────────────────────
    case 'connected':
      role = 'viewer';
      sendToRenderer('session-connected', { hostId: msg.hostId });
      console.log(`[viewer] Prisijungta prie: ${msg.hostId}`);
      break;

    // ── VIEWER: gauna ekrano kadrą ───────────────────────────────────────────
    case 'frame':
      sendToRenderer('frame', {
        data  : msg.data,
        width : msg.width,
        height: msg.height,
        ts    : msg.ts,
      });
      break;

    // ── HOST: gauna įvesties įvykį ───────────────────────────────────────────
    case 'input':
      if (role === 'host') {
        await handleInputEvent(msg.event);
      }
      break;

    // ── Klaida ───────────────────────────────────────────────────────────────
    case 'error':
      sendToRenderer('error', { message: msg.message, code: msg.code });
      console.error('[server error]', msg.message);
      break;

    // ── Host atsijungė (viewer perspektyvos) ─────────────────────────────────
    case 'host_disconnected':
      sendToRenderer('host-disconnected', {});
      role = null;
      break;

    // ── Failų perdavimas ─────────────────────────────────────────────────────
    case 'file_start':
      handleFileStart(msg);
      break;
    case 'file_chunk':
      handleFileChunk(msg);
      break;
    case 'file_end':
      handleFileEnd(msg);
      break;

    case 'pong':
      // Heartbeat patvirtinimas
      break;
  }
}

// ─── Ekrano fiksavimo paleidimas ──────────────────────────────────────────────
function startScreenStream(options = {}) {
  if (captureCtrl) captureCtrl.stop();

  captureCtrl = startCapture(
    (frame) => {
      sendWS({
        type  : 'frame',
        data  : frame.data,
        width : frame.width,
        height: frame.height,
        ts    : Date.now(),
      });
    },
    {
      quality : options.quality  ?? 65,
      scale   : options.scale    ?? 0.9,
      interval: options.interval ?? 50,  // ~20fps
    }
  );

  console.log('[capture] Ekrano transliacija paleista');
}

function stopScreenStream() {
  if (captureCtrl) {
    captureCtrl.stop();
    captureCtrl = null;
    console.log('[capture] Ekrano transliacija sustabdyta');
  }
}

// ─── Failų perdavimas ─────────────────────────────────────────────────────────
const activeTransfers = new Map(); // transferId → { filename, chunks: [] }

function handleFileStart(msg) {
  activeTransfers.set(msg.transferId, {
    filename : msg.filename,
    size     : msg.size,
    chunks   : [],
    received : 0,
  });
  sendToRenderer('file-transfer-start', { transferId: msg.transferId, filename: msg.filename, size: msg.size });
}

function handleFileChunk(msg) {
  const transfer = activeTransfers.get(msg.transferId);
  if (!transfer) return;

  const chunk = Buffer.from(msg.data, 'base64');
  transfer.chunks.push(chunk);
  transfer.received += chunk.length;

  const progress = Math.round((transfer.received / transfer.size) * 100);
  sendToRenderer('file-transfer-progress', { transferId: msg.transferId, progress });
}

async function handleFileEnd(msg) {
  const transfer = activeTransfers.get(msg.transferId);
  if (!transfer) return;

  activeTransfers.delete(msg.transferId);

  // Pasiūlome išsaugoti failą
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: transfer.filename,
    title      : 'Išsaugoti gautą failą',
  });

  if (filePath) {
    const fileData = Buffer.concat(transfer.chunks);
    fs.writeFileSync(filePath, fileData);
    sendToRenderer('file-transfer-done', { transferId: msg.transferId, savedPath: filePath });
  }
}

// ─── IPC: renderer → main ────────────────────────────────────────────────────

// 1. Registruotis kaip host
ipcMain.on('register-host', (_, { password }) => {
  connectToRelay();
  // Palaukiam prisijungimo
  const tryRegister = () => {
    if (isConnectedToRelay) {
      sendWS({ type: 'register', password });
    } else {
      setTimeout(tryRegister, 500);
    }
  };
  tryRegister();
});

// 2. Prisijungti kaip viewer
ipcMain.on('connect-viewer', (_, { targetId, password }) => {
  connectToRelay();
  const tryConnect = () => {
    if (isConnectedToRelay) {
      sendWS({ type: 'connect', targetId, password });
    } else {
      setTimeout(tryConnect, 500);
    }
  };
  tryConnect();
});

// 3. Atsijungti
ipcMain.on('disconnect', () => {
  stopScreenStream();
  role = null;
  myId = null;
  sendToRenderer('disconnected', {});
});

// 4. Viewer siunčia įvesties įvykį
ipcMain.on('input-event', (_, event) => {
  sendWS({ type: 'input', event });
});

// 5. Keisti kokybę
ipcMain.on('set-quality', (_, { quality, scale }) => {
  if (captureCtrl) {
    if (quality) captureCtrl.setQuality(quality);
    if (scale)   captureCtrl.setScale(scale);
  }
});

// 6. Siųsti failą
ipcMain.on('send-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pasirinkite failą siuntimui',
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return;

  const filePath  = result.filePaths[0];
  const filename  = path.basename(filePath);
  const fileData  = fs.readFileSync(filePath);
  const size      = fileData.length;
  const transferId= Date.now().toString();
  const CHUNK_SIZE= 64 * 1024; // 64KB chunks

  sendWS({ type: 'file_start', transferId, filename, size });

  for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
    const chunk = fileData.slice(offset, offset + CHUNK_SIZE);
    sendWS({ type: 'file_chunk', transferId, data: chunk.toString('base64') });
    await new Promise(r => setTimeout(r, 5)); // throttle
  }

  sendWS({ type: 'file_end', transferId });
  sendToRenderer('file-sent', { filename, size });
});

// 7. Gauti serverio URL
ipcMain.handle('get-server-url', () => SERVER_URL);

// 8. Gauti ekrano dydį
ipcMain.handle('get-screen-size', () => {
  const primary = screen.getPrimaryDisplay();
  return primary.size;
});

// ─── Pagalbinė: siųsti į renderer ────────────────────────────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── Valymas ─────────────────────────────────────────────────────────────────
function cleanup() {
  stopScreenStream();
  clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch {} }
}

// ─── Electron gyvavimo ciklas ─────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  connectToRelay();

  // Heartbeat kas 30s
  setInterval(() => sendWS({ type: 'ping' }), 30_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanup);
