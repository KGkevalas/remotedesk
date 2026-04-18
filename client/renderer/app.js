/**
 * app.js – Renderer proceso UI logika
 *
 * Valdo:
 *  • Ekranų perjungimą (pagrindinis / peržiūra)
 *  • Host registraciją ir sesijos rodymą
 *  • Viewer prisijungimą ir ekrano vaizdavimą
 *  • Įvesties įvykių siuntimą (pelė + klaviatūra)
 *  • Failų perdavimo UI
 *  • Toast pranešimus
 */

'use strict';

// ─── DOM elementai ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Pagrindinis ekranas
const screenMain       = $('screen-main');
const screenView       = $('screen-view');

// Relay statusas
const relayDot         = $('relay-dot');
const relayLabel       = $('relay-label');

// Host
const hostSetup        = $('host-setup');
const hostActive       = $('host-active');
const hostPassword     = $('host-password');
const btnStartHost     = $('btn-start-host');
const btnStopHost      = $('btn-stop-host');
const btnEyeHost       = $('btn-eye-host');
const hostIdEl         = $('host-id');
const btnCopyId        = $('btn-copy-id');
const hostStatusBadge  = $('host-status-badge');
const qualitySlider    = $('quality-slider');
const qualityVal       = $('quality-val');
const btnSendFileHost  = $('btn-send-file-host');

// Viewer
const viewerTargetId   = $('viewer-target-id');
const viewerPassword   = $('viewer-password');
const btnConnect       = $('btn-connect');
const btnEyeViewer     = $('btn-eye-viewer');
const viewerSetup      = $('viewer-setup');
const viewerConnecting = $('viewer-connecting');

// Peržiūros ekranas
const remoteCanvas     = $('remote-canvas');
const canvasWrapper    = $('canvas-wrapper');
const canvasOverlay    = $('canvas-overlay');
const overlayText      = $('overlay-text');
const btnDisconnect    = $('btn-disconnect');
const btnFullscreen    = $('btn-fullscreen');
const btnSendFileViewer= $('btn-send-file-viewer');
const viewConnBadge    = $('view-conn-badge');
const viewHostIdLabel  = $('view-host-id-label');
const fpsCounter       = $('fps-counter');
const fileProgressBar  = $('file-progress-bar');
const fileProgressInner= $('file-progress-inner');
const fileProgressLabel= $('file-progress-label');

// Server URL
const serverUrlLabel   = $('server-url-label');

const ctx = remoteCanvas.getContext('2d');

// ─── Būsena ───────────────────────────────────────────────────────────────────
let role = null;          // 'host' | 'viewer'
let hostId = null;
let frameCount = 0;
let lastFpsCheck = Date.now();
let hostScreenSize = { width: 1920, height: 1080 };

// ─── Inicializavimas ──────────────────────────────────────────────────────────
window.remoteDesk.getServerUrl().then(url => {
  serverUrlLabel.textContent = url;
});

// ─── IPC įvykiai iš main proceso ─────────────────────────────────────────────

window.remoteDesk.on('relay-status', ({ connected, url }) => {
  if (connected) {
    relayDot.className   = 'dot dot-green';
    relayLabel.textContent = 'Serveris: prisijungta';
  } else {
    relayDot.className   = 'dot dot-red';
    relayLabel.textContent = 'Serveris: jungiamasi...';
  }
});

window.remoteDesk.on('registered', ({ id }) => {
  hostId = id;
  hostIdEl.textContent = id;
  hostSetup.classList.add('hidden');
  hostActive.classList.remove('hidden');
  btnSendFileHost.classList.remove('hidden');
  toast('Sesija paleista! Dabar galite duoti ID kitam vartotojui.', 'success');
});

window.remoteDesk.on('viewer-connected', () => {
  hostStatusBadge.textContent  = '● Viewer prisijungė';
  hostStatusBadge.className    = 'badge badge-green';
  toast('Viewer prisijungė prie jūsų ekrano!', 'info');
});

window.remoteDesk.on('viewer-disconnected', () => {
  hostStatusBadge.textContent = 'Laukiama prisijungimo...';
  hostStatusBadge.className   = 'badge badge-waiting';
  toast('Viewer atsijungė.', 'info');
});

window.remoteDesk.on('session-connected', ({ hostId: hId }) => {
  viewHostIdLabel.textContent = `Host: ${hId}`;
  showScreen('view');
  showOverlay(false);
  toast('Sėkmingai prisijungta!', 'success');
});

window.remoteDesk.on('frame', ({ data, width, height }) => {
  renderFrame(data, width, height);
  frameCount++;
});

window.remoteDesk.on('host-disconnected', () => {
  toast('Host atsijungė. Sesija baigta.', 'error');
  showOverlay(true, 'Host atsijungė');
  setTimeout(() => {
    showScreen('main');
    resetViewer();
  }, 2500);
});

window.remoteDesk.on('disconnected', () => {
  showScreen('main');
  resetHost();
  resetViewer();
});

window.remoteDesk.on('error', ({ message, code }) => {
  toast(message || 'Klaida', 'error');
  // Viewer: grąžinti formą
  if (viewerConnecting && !viewerConnecting.classList.contains('hidden')) {
    viewerConnecting.classList.add('hidden');
    viewerSetup.classList.remove('hidden');
  }
});

// Failų perdavimas
window.remoteDesk.on('file-transfer-start', ({ filename, size }) => {
  fileProgressBar.classList.remove('hidden');
  fileProgressInner.style.width = '0%';
  fileProgressLabel.textContent = `Gaunamas: ${filename} (${formatBytes(size)})`;
});

window.remoteDesk.on('file-transfer-progress', ({ progress }) => {
  fileProgressInner.style.width = `${progress}%`;
});

window.remoteDesk.on('file-transfer-done', ({ savedPath }) => {
  fileProgressBar.classList.add('hidden');
  toast(`Failas išsaugotas: ${savedPath}`, 'success');
});

window.remoteDesk.on('file-sent', ({ filename, size }) => {
  toast(`Failas išsiųstas: ${filename} (${formatBytes(size)})`, 'success');
});

// ─── HOST mygtukai ────────────────────────────────────────────────────────────

btnStartHost.addEventListener('click', () => {
  const password = hostPassword.value.trim();
  if (password.length < 4) {
    toast('Slaptažodis per trumpas (min. 4 simboliai)', 'error');
    return;
  }
  window.remoteDesk.registerHost(password);
  btnStartHost.textContent = 'Paleidžiama...';
  btnStartHost.disabled    = true;
});

btnStopHost.addEventListener('click', () => {
  window.remoteDesk.disconnect();
  resetHost();
  toast('Sesija sustabdyta.', 'info');
});

btnCopyId.addEventListener('click', () => {
  if (hostId) {
    navigator.clipboard.writeText(hostId);
    toast('ID nukopijuotas į iškarpinę!', 'success');
  }
});

btnEyeHost.addEventListener('click', () => togglePasswordVisibility(hostPassword));

qualitySlider.addEventListener('input', () => {
  const q = parseInt(qualitySlider.value);
  qualityVal.textContent = `${q}%`;
  window.remoteDesk.setQuality(q, null);
});

btnSendFileHost.addEventListener('click', () => window.remoteDesk.sendFile());

// ─── VIEWER mygtukai ──────────────────────────────────────────────────────────

btnConnect.addEventListener('click', connectViewer);

viewerTargetId.addEventListener('keydown', e => {
  if (e.key === 'Enter') viewerPassword.focus();
  // Auto-formatavimas: pridėti brūkšnelius
  autoFormatId(e);
});

viewerPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter') connectViewer();
});

btnEyeViewer.addEventListener('click', () => togglePasswordVisibility(viewerPassword));

function connectViewer() {
  const targetId = viewerTargetId.value.trim().toUpperCase();
  const password = viewerPassword.value;

  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(targetId)) {
    toast('Neteisingas ID formatas (pvz.: ABC-123-XYZ)', 'error');
    return;
  }
  if (!password) {
    toast('Įveskite slaptažodį', 'error');
    return;
  }

  viewerSetup.classList.add('hidden');
  viewerConnecting.classList.remove('hidden');

  window.remoteDesk.connectViewer(targetId, password);
}

// ─── Peržiūros ekranas ────────────────────────────────────────────────────────

btnDisconnect.addEventListener('click', () => {
  window.remoteDesk.disconnect();
  showScreen('main');
  resetViewer();
  toast('Atsijungta.', 'info');
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    canvasWrapper.requestFullscreen();
    btnFullscreen.textContent = '⊡ Sumažinti';
  } else {
    document.exitFullscreen();
    btnFullscreen.textContent = '⛶ Pilnas';
  }
});

btnSendFileViewer.addEventListener('click', () => window.remoteDesk.sendFile());

// ─── Ekrano vaizdavimas ───────────────────────────────────────────────────────

function renderFrame(base64, width, height) {
  const img   = new Image();
  img.onload  = () => {
    // Adaptyvus dydis: canvas atitinka gaunamą rezoliuciją
    if (remoteCanvas.width !== width || remoteCanvas.height !== height) {
      remoteCanvas.width  = width;
      remoteCanvas.height = height;
      hostScreenSize = { width, height };
    }
    ctx.drawImage(img, 0, 0, width, height);
  };
  img.src = `data:image/jpeg;base64,${base64}`;
}

// FPS skaičiuoklė
setInterval(() => {
  const now  = Date.now();
  const dt   = (now - lastFpsCheck) / 1000;
  const fps  = Math.round(frameCount / dt);
  frameCount   = 0;
  lastFpsCheck = now;
  if (document.getElementById('screen-view').classList.contains('active')) {
    fpsCounter.textContent = `${fps} fps`;
  }
}, 1000);

// ─── Įvesties perėmimas (viewer) ──────────────────────────────────────────────

canvasWrapper.addEventListener('mousemove', (e) => {
  const { relX, relY } = toRelative(e);
  window.remoteDesk.sendInputEvent({ type: 'mousemove', relX, relY });
});

canvasWrapper.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const { relX, relY } = toRelative(e);
  window.remoteDesk.sendInputEvent({ type: 'mousedown', relX, relY, button: e.button });
});

canvasWrapper.addEventListener('mouseup', (e) => {
  e.preventDefault();
  const { relX, relY } = toRelative(e);
  window.remoteDesk.sendInputEvent({ type: 'mouseup', relX, relY, button: e.button });
});

canvasWrapper.addEventListener('click', (e) => {
  const { relX, relY } = toRelative(e);
  window.remoteDesk.sendInputEvent({ type: 'click', relX, relY, button: e.button });
});

canvasWrapper.addEventListener('dblclick', (e) => {
  const { relX, relY } = toRelative(e);
  window.remoteDesk.sendInputEvent({ type: 'dblclick', relX, relY });
});

canvasWrapper.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const { relX, relY } = toRelative(e);
  window.remoteDesk.sendInputEvent({ type: 'click', relX, relY, button: 2 });
});

canvasWrapper.addEventListener('wheel', (e) => {
  e.preventDefault();
  window.remoteDesk.sendInputEvent({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
}, { passive: false });

// Klaviatūra (kai esame peržiūros ekrane)
document.addEventListener('keydown', (e) => {
  if (!screenView.classList.contains('active')) return;
  if (isTypingInInput(e.target)) return;
  e.preventDefault();
  window.remoteDesk.sendInputEvent({ type: 'keydown', key: e.key, code: e.code });
});

document.addEventListener('keyup', (e) => {
  if (!screenView.classList.contains('active')) return;
  if (isTypingInInput(e.target)) return;
  e.preventDefault();
  window.remoteDesk.sendInputEvent({ type: 'keyup', key: e.key, code: e.code });
});

// ─── Pagalbinės funkcijos ─────────────────────────────────────────────────────

function toRelative(e) {
  const rect = remoteCanvas.getBoundingClientRect();
  const relX = (e.clientX - rect.left)  / rect.width;
  const relY = (e.clientY - rect.top)   / rect.height;
  return {
    relX: Math.max(0, Math.min(1, relX)),
    relY: Math.max(0, Math.min(1, relY)),
  };
}

function showScreen(name) {
  screenMain.classList.remove('active');
  screenView.classList.remove('active');

  if (name === 'main') screenMain.classList.add('active');
  if (name === 'view') screenView.classList.add('active');
}

function showOverlay(visible, text = '') {
  if (visible) {
    canvasOverlay.classList.remove('hidden');
    overlayText.textContent = text;
  } else {
    canvasOverlay.classList.add('hidden');
  }
}

function resetHost() {
  hostSetup.classList.remove('hidden');
  hostActive.classList.add('hidden');
  btnSendFileHost.classList.add('hidden');
  hostPassword.value        = '';
  hostId                    = null;
  btnStartHost.textContent  = 'Pradėti dalinimąsi';
  btnStartHost.disabled     = false;
  hostStatusBadge.textContent = 'Laukiama prisijungimo...';
  hostStatusBadge.className   = 'badge badge-waiting';
}

function resetViewer() {
  viewerSetup.classList.remove('hidden');
  viewerConnecting.classList.add('hidden');
  viewerTargetId.value = '';
  viewerPassword.value = '';
}

function togglePasswordVisibility(input) {
  input.type = input.type === 'password' ? 'text' : 'password';
}

function autoFormatId(e) {
  // Formatuojam įvedamą ID: automatiškai deda brūkšnelius
  setTimeout(() => {
    let val = viewerTargetId.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (val.length > 3)  val = val.slice(0,3) + '-' + val.slice(3);
    if (val.length > 7)  val = val.slice(0,7) + '-' + val.slice(7);
    if (val.length > 11) val = val.slice(0,11);
    viewerTargetId.value = val;
  }, 0);
}

function isTypingInInput(el) {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}

// ─── Toast pranešimai ─────────────────────────────────────────────────────────

function toast(message, type = 'info', duration = 4000) {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className   = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transition= 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}
