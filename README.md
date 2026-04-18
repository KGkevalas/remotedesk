# RemoteDesk – TeamViewer alternatyva (MVP)

Nuotolinio valdymo programa, veikianti per jūsų VPS serverį.  
Pilna architektūra: **Relay Server (VPS)** ↔ **Host klientas** ↔ **Viewer klientas**

---

## Architektūros schema

```
┌─────────────────────────────────────────────────────────────────┐
│                        VPS SERVERIS                             │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │            WebSocket Relay Server (Node.js)              │  │
│   │                    Prievadas: 8080                       │  │
│   │                                                          │  │
│   │  • Host registracija (ID + slaptažodžio hash)            │  │
│   │  • Viewer autentifikacija                                │  │
│   │  • Kadrų relay (Host → Viewer)                          │  │
│   │  • Įvesties relay (Viewer → Host)                       │  │
│   │  • Failų perdavimo relay                                │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────┬──────────────────────┬────────────────────┘
                      │ WebSocket             │ WebSocket
                      │ (ws:// arba wss://)   │ (ws:// arba wss://)
          ┌───────────▼───────────┐  ┌────────▼────────────────┐
          │    HOST KOMPIUTERIS   │  │   VIEWER KOMPIUTERIS    │
          │                       │  │                         │
          │  Electron App         │  │  Electron App           │
          │  ┌─────────────────┐  │  │  ┌──────────────────┐  │
          │  │ Screen Capture  │  │  │  │ Canvas Renderer  │  │
          │  │ (screenshot-    │  │  │  │ (JPEG → canvas)  │  │
          │  │  desktop)       │  │  │  └──────────────────┘  │
          │  └────────┬────────┘  │  │  ┌──────────────────┐  │
          │           │ JPEG      │  │  │ Input Capture    │  │
          │           │ frames    │  │  │ (mouse + kb)     │  │
          │  ┌────────▼────────┐  │  │  └────────┬─────────┘  │
          │  │ Input Injection │  │  │           │             │
          │  │ (nut-js /       │◄─┼──┼───────────┘ events     │
          │  │  robotjs)       │  │  │                         │
          │  └─────────────────┘  │  └─────────────────────────┘
          └───────────────────────┘
```

### Duomenų srautai

```
Ekrano transliacija:
  Host ekranas → screenshot-desktop → JPEG (base64) → WebSocket → Relay → Viewer → Canvas

Valdymas:
  Viewer pelė/klaviatūra → WebSocket → Relay → Host → nut-js → OS

Failų siuntimas:
  Failas → 64KB chunks (base64) → WebSocket → Relay → Viewer → Dialog
```

---

## Projekto struktūra

```
remote-desktop/
├── server/                   ← VPS relay serveris
│   ├── server.js             ← Pagrindinis serveris
│   └── package.json
│
└── client/                   ← Electron klientas (Host + Viewer)
    ├── main.js               ← Electron main process
    ├── preload.js            ← IPC tiltas
    ├── package.json
    ├── src/
    │   ├── capture.js        ← Ekrano fiksavimas
    │   ├── input-handler.js  ← Įvesties valdymas
    │   └── crypto-util.js    ← AES-256-GCM šifravimas
    └── renderer/
        ├── index.html        ← UI struktūra
        ├── style.css         ← Stiliai
        └── app.js            ← UI logika
```

---

## Greitas paleidimas

### 1. VPS serverio paruošimas

```bash
# Ubuntu 22.04 / Debian
sudo apt update && sudo apt install -y nodejs npm

# Node.js 20+ (jei reikia atnaujinti)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Patikrinkite
node -v  # >= 18.0.0

# Nukopijuokite serveri į VPS (iš savo kompiuterio)
scp -r remote-desktop/server user@YOUR_VPS_IP:/opt/remotedesk-server

# VPS terminale
cd /opt/remotedesk-server
npm install

# Paleisti
node server.js
# arba fone (su pm2)
npm install -g pm2
pm2 start server.js --name remotedesk
pm2 save
pm2 startup
```

### 2. Ugniasienis (Firewall)

```bash
# UFW (Ubuntu)
sudo ufw allow 8080/tcp
sudo ufw reload

# arba DigitalOcean / Hetzner – atidaryti 8080 TCP paskyroje
```

### 3. TLS (HTTPS/WSS) – rekomenduojama

```bash
# Nginx kaip reverse proxy + Let's Encrypt
sudo apt install -y nginx certbot python3-certbot-nginx

# Konfigūracija /etc/nginx/sites-available/remotedesk:
server {
    listen 80;
    server_name jūsų-domenas.com;

    location / {
        proxy_pass          http://localhost:8080;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade $http_upgrade;
        proxy_set_header    Connection "upgrade";
        proxy_set_header    Host $host;
        proxy_read_timeout  86400;
    }
}

sudo certbot --nginx -d jūsų-domenas.com
```

---

## Kliento diegimas

### Reikalavimai

- Node.js >= 18
- Windows 10/11 arba Ubuntu 20.04+
- Build įrankiai (Windows): `npm install -g windows-build-tools`

### Diegimas

```bash
cd remote-desktop/client
npm install

# Jei robotjs kompiliavimo klaida (Windows):
npm install --global --production windows-build-tools
npm install

# Arba naudokite nut-js (paprastesnė alternatyva – nereikia kompiliuoti):
npm install @nut-tree-fork/nut-js
```

### Paleisti

```bash
# Nustatykite serverio adresą aplinkos kintamuoju
SERVER_URL=ws://JŪSŲ_VPS_IP:8080 npm start

# Windows PowerShell:
$env:SERVER_URL="ws://JŪSŲ_VPS_IP:8080"; npm start

# arba redaguokite main.js eilutę:
const SERVER_URL = 'ws://JŪSŲ_VPS_IP:8080';
```

---

## Portabilūs paketai (Portable / USB)

```bash
# Windows portable .exe (nereikia diegimo)
npm run build:portable
# Rezultatas: dist/RemoteDesk*.exe

# Windows installer
npm run build:win
# Rezultatas: dist/RemoteDesk*Setup*.exe

# Linux AppImage
npm run build:linux
# Rezultatas: dist/RemoteDesk*.AppImage
```

---

## Naudojimas

### HOST (ekrano dalinimas)

1. Paleiskite RemoteDesk
2. Pasirinkite **"Dalintis ekranu"** kortelę
3. Įveskite slaptažodį (bent 4 simboliai)
4. Spauskite **"Pradėti dalinimąsi"**
5. Jums bus suteiktas unikalus **ID** (pvz.: `ABC-123-XYZ`)
6. Perduokite ID ir slaptažodį viewer'iui

### VIEWER (valdymas)

1. Paleiskite RemoteDesk
2. Pasirinkite **"Prisijungti"** kortelę
3. Įveskite Host **ID** ir **slaptažodį**
4. Spauskite **"Prisijungti"**
5. Matysite ir valdysite Host ekraną realiu laiku

### Failų perdavimas

- Paspauskite **"📁 Siųsti failą"** – pasirinkite failą dialoge
- Failas bus perduotas ir gaunantiems pasiūlyta išsaugoti

---

## Dependencies

### Serveris (server/)

| Paketas   | Versija | Paskirtis                       |
|-----------|---------|---------------------------------|
| ws        | ^8.17   | WebSocket serveris              |
| bcryptjs  | ^2.4    | Slaptažodžių hash'inimas        |
| nodemon   | ^3.1    | Auto-restart kūrimui (dev only) |

### Klientas (client/)

| Paketas                   | Versija | Paskirtis                     |
|---------------------------|---------|-------------------------------|
| electron                  | ^31     | Desktop app karkasas          |
| screenshot-desktop        | ^1.15   | Ekrano fiksavimas             |
| sharp                     | ^0.33   | JPEG kompresija (optional)    |
| @nut-tree-fork/nut-js     | ^4.2    | Pelės/klaviatūros valdymas    |
| ws                        | ^8.17   | WebSocket klientas            |
| electron-builder          | ^24     | Paketavimas (.exe, AppImage)  |

---

## Saugumas

| Aspektas               | Sprendimas                                    |
|------------------------|-----------------------------------------------|
| Transporto saugumas    | WSS (TLS) per Nginx + Let's Encrypt           |
| Slaptažodžiai          | bcrypt (cost=10) serveryje                    |
| Sesijų izolacija       | Kiekvienas viewer turi atskirą WebSocket ryšį |
| Šifravimas (papildomas)| AES-256-GCM modulis `crypto-util.js`          |
| ID unikalumas          | Kriptografiškai atsitiktiniai (32 bitų)       |

---

## Galimi patobulinimai (Post-MVP)

- **WebRTC P2P** – tiesioginis ryšys tarp klientų (mažesnė latencija)
- **STUN/TURN** – NAT traversal be relay serverio
- **Multi-monitor** – kelių monitorių palaikymas
- **Clipboard sync** – iškarpinės sinchronizavimas
- **Audio stream** – garso perdavimas
- **Session recording** – sesijų įrašymas
- **Access control** – leidimų sistema (tik peržiūra vs. pilnas valdymas)
- **Mobile client** – React Native arba PWA

---

## Dažnos klaidos

### `screenshot-desktop` klaida (Linux)
```bash
# Įdiekite X11 priklausomybes
sudo apt install -y libx11-dev libxkbfile-dev libsecret-1-dev
```

### `@nut-tree/nut-js` klaida (Windows)
```bash
# Administratoriaus teisės reikalingos įvesties valdymui
# Paleiskite RemoteDesk kaip administratorius
```

### WebSocket ryšio klaida
```
# Patikrinkite:
# 1. VPS ugniasienis leidžia prievadą 8080
# 2. SERVER_URL kintamasis teisingas
# 3. Serveris veikia: pm2 status
```

---

## Licencija

MIT – naudokite laisvai.
