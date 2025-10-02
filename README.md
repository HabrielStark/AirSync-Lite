# AirSync-Lite
AirSync-Lite keeps folders in sync between macOS and Windows with secure peer-to-peer transfers. This README is written for beginners. Follow it step by step and you will have AirSync-Lite running even if you have never used Node.js or Electron before.

---

## 🧠 Before You Start

### Hardware & Software
- One macOS laptop (macOS 12 Monterey or newer)
- One Windows 10/11 PC
- Both machines on the same Wi-Fi/LAN (internet works too, LAN is simpler)
- Node.js 20.x + npm 10.x installed on both machines
- Git installed (optional but recommended)

### What You Get
- Automatic folder sync between devices
- Conflict detection with manual resolution tools
- Offline/online resume (changes queue while a device is offline)
- End-to-end encrypted data (AES-256-GCM + signed payloads)

---

## 🚀 Quick Start (5 minutes)

```bash
# 1. Clone the repository or download the ZIP
 git clone https://github.com/example/AirSync-Lite.git
 cd AirSync-Lite

# 2. Install dependencies
 npm install --legacy-peer-deps

# 3. Build the codebase (main + renderer)
 npm run build

# 4. Launch the development app
 npm start
```

Repeat on both machines. On first launch the onboarding wizard helps you pick the folders you want to sync.

> 💡 **Need a prebuilt installer?** Run `npm run pack` (macOS/Windows/Linux) or check `dist-app/` for the generated binaries.

---

## 🖥️ Running AirSync-Lite

| Goal | Command |
|------|---------|
| Start full app (Electron + renderer) | `npm start`
| Start only the Electron main process | `npm run start:main`
| Start only the renderer dev server | `npm run start:renderer`
| Package unsigned binaries | `npm run pack`
| Build signed installers | `npm run dist`

The desktop UI contains four key tabs:
- **Folders** — list of paths you keep in sync
- **Devices** — shows paired peers (Mac, Windows, etc.)
- **History** — every change with restore buttons
- **Conflicts** — files that need manual resolution

---

## 🧪 Manual “Live” Tests

Perform these four checks after installation:

1. **Quick Sync**
   - Pick the same folder on macOS and Windows (e.g., `~/Documents/AirSync/Projects`).
   - Create `test.txt` on macOS with “hello” inside.
   - Wait for the file to appear on Windows.
   - Edit it on Windows and confirm the update syncs back to macOS.

2. **Conflict Handling**
   - Open `test.txt` simultaneously on both devices.
   - Save “A” on macOS and “B” on Windows.
   - AirSync-Lite should create a conflict copy and show a notification.
   - Open the **Conflicts** tab, inspect versions, and pick the winner.

3. **Resume After Interrupt**
   - Copy a large file (50–200 MB) into the synced folder.
   - While syncing, force-quit AirSync on Windows (Task Manager → End task).
   - Relaunch AirSync; it should resume or restart the transfer gracefully.

4. **Offline → Online**
   - Disconnect Windows from Wi-Fi.
   - Make several edits on macOS.
   - Reconnect Windows; all pending edits should sync automatically.

If a scenario fails, jump to **Troubleshooting**.

---

## 🧩 Everyday Tasks

### Add a Folder to Sync
1. Open the app.
2. Go to **Folders → Add Folder**.
3. Select the path and confirm.

### Pair a New Device
1. On the new machine, launch AirSync-Lite and select **Pair with existing device**.
2. Scan the QR code or type the pairing code shown on your primary device.
3. Approve the request on the original device.

### Pause or Resume Sync
- Use the tray icon menu (macOS menu bar / Windows system tray) and toggle **Pause Sync**.
- Or run `airsync pause` / `airsync resume` in the CLI.

### Check Sync Status via CLI
```bash
npm run cli -- status
# or (if installed globally)
airsync status
```

---

## 🧰 Troubleshooting

| Symptom | Fix |
|---------|-----|
| File never appears on the other machine | Ensure both devices are online, ports 40777/40778 are open, and folder paths match exactly. |
| Windows error about `better-sqlite3` bindings | Run `npm rebuild better-sqlite3 --runtime=electron --target=32.2.7`. |
| Conflict notifications missing | Enable **Settings → Security → Conflict detection**. |
| Transfers extremely slow | Enable relay fallback in **Settings → Network**, ensure firewall allows traffic, prefer wired LAN. |
| App cannot access folders | On macOS grant access in **System Settings → Privacy & Security → Files & Folders**; on Windows allow the firewall prompt. |

Still stuck? Tail the logs:
```bash
npm run logs  # streams logs/main.log and logs/renderer.log
```
Copy relevant lines when asking for help.

---

## 🧪 Automated Testing (Optional)

```bash
# Linting
npm run lint

# Unit tests (21 suites)
npm run test:unit

# Integration tests (CLI, pairing, rate limit, secure channel)
npm run test:integration

# Coverage summary
npm run test:coverage

# Playwright E2E (requires Chromium / Playwright browsers)
npm run test:e2e
```

> ⚠️ Note: Security tests in `tests/security` are experimental; some Windows runs require rebuilding native modules.

---

## ⚙️ Configuration via .env

All environment variables live in `.env`. Start by copying the sample:

```bash
cp .env.example .env
```

Key entries:
- `SYNC_PORT` — default `40777`
- `LOG_LEVEL` — `error`, `warn`, `info`, or `debug`
- `ENABLE_DEVTOOLS` — set to `false` for production builds

Never commit `.env`. Production secrets go to your OS keychain (see `SECURITY.md`).

---

## 🧱 Building Installers

```bash
# macOS .dmg (requires Apple Developer ID for signing)
npm run dist:mac

# Windows .msi (requires signtool for signing)
npm run dist:win

# Linux AppImage
npm run dist:linux
```

Artifacts appear in `dist-app/`.

---

## 🙋 FAQ

**Q: Can the devices sync when not simultaneously online?**  
Yes. Changes queue up offline and apply once both devices reconnect.

**Q: Is the data encrypted in transit?**  
Yes. AirSync-Lite uses AES-256-GCM encryption and signed messages (ed25519).

**Q: Can I have more than two devices?**  
Yes. Pair as many peers as you like. Each device keeps the same folder set in sync.

**Q: Does it work across the internet?**  
Yes. It prefers direct peer to peer but falls back to secure relays if needed.

**Q: Where are previous versions stored?**  
Inside a hidden `.airsync` directory within each synced folder. Restore them via the **History** tab.

---

## ❤️ Contributing

We welcome pull requests! Please read `CONTRIBUTING.md` for coding standards, branching strategy, and CI requirements. Every PR must pass **lint → test → build → security scan**.

---

## 🔐 Security

- Read `SECURITY.md` for the disclosure policy and recommended hardening steps.
- Vulnerability reports: `security@airsync-lite.dev` (PGP key in `SECURITY.md`).
- Additional audit information lives in `COMPREHENSIVE_AUDIT_REPORT.md` and `FINAL_PRODUCTION_REPORT.md`.

---

## 📜 License

AirSync-Lite is MIT licensed. See `LICENSE` for full text.

---

### 👋 Need Help?
- Browse the docs in `docs/`
- Join our community Discord (link in-app under **Help → Community**)
- Open a GitHub issue with logs attached

Happy syncing! 🎉
# AirSync-Lite
