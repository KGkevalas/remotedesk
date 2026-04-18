/**
 * RemoteDesk – Relay / Signaling Server
 * Veikia kaip centrinis taškas tarp Host ir Viewer klientų.
 * Protokolas: WebSocket (ws://) – galima pridėti TLS (wss://) su nginx/certbot.
 */

const WebSocket = require('ws');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const https     = require('https');
const http      = require('http');
const fs        = require('fs');

const PORT     = process.env.PORT || 8080;
const USE_TLS  = process.env.USE_TLS === '1';
const CERT     = process.env.TLS_CERT || './cert.pem';
const KEY      = process.env.TLS_KEY  || './key.pem';

// ─── HTTP / HTTPS serveris ────────────────────────────────────────────────────
let httpServer;
if (USE_TLS && fs.existsSync(CERT) && fs.existsSync(KEY)) {
  httpServer = https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) });
  console.log('[server] TLS režimas aktyvus');
} else {
  httpServer = http.createServer();
}

const wss = new WebSocket.Server({ server: httpServer });

// ─── Būsenos saugojimas ───────────────────────────────────────────────────────
/**
 * hosts: Map<hostId, { ws, passwordHash, viewers: Set<ws>, meta: {} }>
 */
const hosts = new Map();

// ─── Pagalbinės funkcijos ─────────────────────────────────────────────────────
function genId(len = 9) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // lengvai skaitomi simboliai
  let id = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    id += chars[bytes[i] % chars.length];
  }
  // Formatuojam: XXX-XXX-XXX
  return `${id.slice(0,3)}-${id.slice(3,6)}-${id.slice(6,9)}`;
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastToViewers(hostEntry, obj) {
  const msg = JSON.stringify(obj);
  hostEntry.viewers.forEach(v => {
    if (v.readyState === WebSocket.OPEN) v.send(msg);
  });
}

// ─── Pagrindinis WebSocket handler ───────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  ws._id   = crypto.randomUUID();
  ws._role = null;   // 'host' | 'viewer'
  ws._host = null;   // hostId, kuris priklauso šiam ws

  console.log(`[+] Prisijungė: ${ip}  (${ws._id})`);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── HOST: registracija ──────────────────────────────────────────────────
    if (msg.type === 'register') {
      const { password } = msg;
      if (!password || password.length < 4) {
        send(ws, { type: 'error', code: 'WEAK_PASSWORD', message: 'Slaptažodis per trumpas (min 4 simboliai)' });
        return;
      }

      const id           = genId();
      const passwordHash = await bcrypt.hash(password, 10);

      hosts.set(id, {
        ws,
        passwordHash,
        viewers : new Set(),
        meta    : { ip, connectedAt: Date.now() },
      });

      ws._role = 'host';
      ws._host = id;

      send(ws, { type: 'registered', id });
      console.log(`[HOST] Užregistruotas: ${id}  (${ip})`);
    }

    // ── VIEWER: jungiamasi prie host ────────────────────────────────────────
    else if (msg.type === 'connect') {
      const { targetId, password } = msg;
      const host = hosts.get(targetId);

      if (!host) {
        send(ws, { type: 'error', code: 'HOST_NOT_FOUND', message: 'Host nerastas. Patikrinkite ID.' });
        return;
      }

      const valid = await bcrypt.compare(password, host.passwordHash);
      if (!valid) {
        send(ws, { type: 'error', code: 'WRONG_PASSWORD', message: 'Neteisingas slaptažodis.' });
        return;
      }

      ws._role = 'viewer';
      ws._host = targetId;
      host.viewers.add(ws);

      // Pranešam host apie naują viewer
      send(host.ws, { type: 'viewer_connected', viewerId: ws._id });
      send(ws, { type: 'connected', hostId: targetId });

      console.log(`[VIEWER] ${ws._id} prisijungė prie ${targetId}`);
    }

    // ── HOST → VIEWERS: ekrano kadras ───────────────────────────────────────
    else if (msg.type === 'frame') {
      if (ws._role !== 'host') return;
      const host = hosts.get(ws._host);
      if (!host) return;

      // Perduodam kadrus tiesiogiai (relay) – nekeičiam duomenų
      const packed = JSON.stringify({
        type   : 'frame',
        data   : msg.data,
        width  : msg.width,
        height : msg.height,
        ts     : msg.ts,
      });

      host.viewers.forEach(v => {
        if (v.readyState === WebSocket.OPEN) v.send(packed);
      });
    }

    // ── VIEWER → HOST: įvesties įvykiai ─────────────────────────────────────
    else if (msg.type === 'input') {
      if (ws._role !== 'viewer') return;
      const host = hosts.get(ws._host);
      if (!host) return;

      send(host.ws, { type: 'input', event: msg.event, viewerId: ws._id });
    }

    // ── FAILŲ PERDAVIMAS (chunked) ───────────────────────────────────────────
    else if (msg.type === 'file_start' || msg.type === 'file_chunk' || msg.type === 'file_end') {
      // Relay tarp host ↔ viewer
      const target = ws._role === 'host'
        ? [...(hosts.get(ws._host)?.viewers || [])][0]   // pirmam viewer'ui
        : hosts.get(ws._host)?.ws;                        // host'ui

      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ ...msg, senderId: ws._id }));
      }
    }

    // ── HEARTBEAT / PING ─────────────────────────────────────────────────────
    else if (msg.type === 'ping') {
      send(ws, { type: 'pong', ts: Date.now() });
    }

    // ── STATISTIKA (debug) ──────────────────────────────────────────────────
    else if (msg.type === 'stats') {
      send(ws, {
        type    : 'stats',
        hosts   : hosts.size,
        viewers : [...hosts.values()].reduce((s, h) => s + h.viewers.size, 0),
        uptime  : process.uptime(),
      });
    }
  });

  // ─── Atsijungimo logika ─────────────────────────────────────────────────────
  ws.on('close', () => {
    console.log(`[-] Atsijungė: ${ws._id}  (${ws._role})`);

    if (ws._role === 'host' && ws._host) {
      const host = hosts.get(ws._host);
      if (host) {
        // Pranešam visiems viewers
        broadcastToViewers(host, { type: 'host_disconnected' });
        hosts.delete(ws._host);
        console.log(`[HOST] Pašalintas: ${ws._host}`);
      }

    } else if (ws._role === 'viewer' && ws._host) {
      const host = hosts.get(ws._host);
      if (host) {
        host.viewers.delete(ws);
        send(host.ws, { type: 'viewer_disconnected', viewerId: ws._id });
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[ERROR] ${ws._id}: ${err.message}`);
  });
});

// ─── Paleidimas ───────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const proto = USE_TLS ? 'wss' : 'ws';
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  RemoteDesk Relay Server                 ║`);
  console.log(`║  Protokolas : ${proto.padEnd(27)}║`);
  console.log(`║  Prievadas  : ${String(PORT).padEnd(27)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Stabdoma...');
  wss.clients.forEach(c => c.close());
  httpServer.close(() => process.exit(0));
});
