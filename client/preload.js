/**
 * preload.js – Electron preload scenarijus
 *
 * Saugiai jungia renderer proceso JavaScript su main procesu per IPC.
 * contextIsolation: true – renderer neturi tiesiogiai prieigos prie Node.js.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remoteDesk', {

  // ── Siųsti į main procesą ──────────────────────────────────────────────────
  registerHost   : (password)         => ipcRenderer.send('register-host',   { password }),
  connectViewer  : (targetId, password) => ipcRenderer.send('connect-viewer', { targetId, password }),
  disconnect     : ()                 => ipcRenderer.send('disconnect'),
  sendInputEvent : (event)            => ipcRenderer.send('input-event',      event),
  setQuality     : (quality, scale)   => ipcRenderer.send('set-quality',      { quality, scale }),
  sendFile       : ()                 => ipcRenderer.send('send-file'),

  // ── Async užklausos ────────────────────────────────────────────────────────
  getServerUrl   : () => ipcRenderer.invoke('get-server-url'),
  getScreenSize  : () => ipcRenderer.invoke('get-screen-size'),

  // ── Klausytis iš main proceso ──────────────────────────────────────────────
  on: (channel, callback) => {
    const allowed = [
      'relay-status',
      'registered',
      'session-connected',
      'viewer-connected',
      'viewer-disconnected',
      'host-disconnected',
      'disconnected',
      'frame',
      'error',
      'file-transfer-start',
      'file-transfer-progress',
      'file-transfer-done',
      'file-sent',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },

  off: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
