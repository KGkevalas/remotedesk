/**
 * capture.js – Ekrano fiksavimas per Electron desktopCapturer
 *
 * Nenaudoja JOKIŲ native modulių – veikia iš karto Windows / Linux / macOS.
 * Electron desktopCapturer → NativeImage → JPEG base64 → WebSocket
 */

'use strict';

const { desktopCapturer, nativeImage, screen } = require('electron');

const DEFAULT_QUALITY  = 65;
const DEFAULT_SCALE    = 0.9;
const DEFAULT_INTERVAL = 50;   // ms (~20fps)

/**
 * captureScreen(options) → Promise<{ data: string, width: number, height: number }>
 */
async function captureScreen(options = {}) {
  const quality = options.quality ?? DEFAULT_QUALITY;
  const scale   = options.scale   ?? DEFAULT_SCALE;

  const primary = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primary.size;
  const scaleFactor = primary.scaleFactor || 1;

  // Tiksliniai matmenys
  const targetW = Math.round(sw * scale);
  const targetH = Math.round(sh * scale);

  // Gauti visus ekranus
  const sources = await desktopCapturer.getSources({
    types       : ['screen'],
    thumbnailSize: {
      width : Math.round(sw * scaleFactor * scale),
      height: Math.round(sh * scaleFactor * scale),
    },
  });

  if (!sources || sources.length === 0) {
    throw new Error('Nepavyko gauti ekrano šaltinio');
  }

  // Pirmasis ekranas
  const source    = sources[0];
  const thumbnail = source.thumbnail;

  // Konvertuoti į JPEG
  const jpegBuf = thumbnail.toJPEG(quality);

  return {
    data  : jpegBuf.toString('base64'),
    width : targetW,
    height: targetH,
  };
}

/**
 * startCapture(onFrame, options) → { stop, setQuality, setScale, setInterval }
 */
function startCapture(onFrame, options = {}) {
  let running  = true;
  let opts     = { ...options };

  async function loop() {
    while (running) {
      const t0 = Date.now();
      try {
        const frame   = await captureScreen(opts);
        const elapsed = Date.now() - t0;
        onFrame({ ...frame, captureMs: elapsed });

        const wait = Math.max(0, (opts.interval ?? DEFAULT_INTERVAL) - elapsed);
        await sleep(wait);
      } catch (err) {
        console.error('[capture] Klaida:', err.message);
        await sleep(opts.interval ?? DEFAULT_INTERVAL);
      }
    }
  }

  loop();

  return {
    stop       : ()  => { running = false; },
    setQuality : (q) => { opts.quality   = q; },
    setScale   : (s) => { opts.scale     = s; },
    setInterval: (i) => { opts.interval  = i; },
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { captureScreen, startCapture, DEFAULT_QUALITY, DEFAULT_SCALE, DEFAULT_INTERVAL };
