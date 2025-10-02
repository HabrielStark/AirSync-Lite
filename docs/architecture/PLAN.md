# AirSync-Lite — Архитектурный план проекта

## 1. Общая стратегия
- Цель: production-ready P2P синхронизатор для macOS/Windows
- Ожидаемый размер кодовой базы: 55–60k строк TypeScript/React
- Подсистемы: файловый движок, сетевой слой, Electron main, UI, CLI, тестирование, security, docs

## 2. Дорожная карта разработки
### Этап A. Файловый движок (15k строк)
1. Watcher (macOS FSEvents, Windows ReadDirectoryChangesW) + кроссплатформенная обвязка
2. Engine поверх Chokidar с пайплайнами add/change/delete/rename
3. Diff-сервис (snapshots, rolling hash, delta алгоритмы)
4. Ignore-служба (.stignore, gitignore merge, presets)
5. Versioning (Simple & Time-based policies, storage layout, cleanup jobs)
6. Конфликт-менеджер (auto copy, conflict queue, UI hooks)

### Этап B. Сетевой стек (8–10k строк)
1. Discovery (LAN broadcast, DHT опционально)
2. Handshake (QR/ID, mutual auth, key exchange)
3. Transport: WebRTC (data channels), WebSocket fallback, TLS поверх TCP
4. Шифрование: AES-GCM поток, re-key, nonce rotation, подписанные payloads
5. Rate limiting & congestion control
6. Relay/NAT traversal (+ TURN/SFU стратегия для сложных сетей)
7. Параллельные transfers + delta replication

### Этап C. Electron main (3–4k строк)
1. Main процесс: сервис-оркестратор, DI контейнер
2. IPC маршалинг + secure preload API
3. Tray/меню, хоткеи, уведомления, battery/network integration
4. Auto-update (electron-updater) + код-подпись
5. Логирование (winston JSON) + ring buffers

### Этап D. UI/Renderer (12–15k строк)
1. App Shell на React + Material UI
2. Dashboard, Folders, Devices, History, Conflicts, Settings
3. Onboarding wizard, QR pairing, presets комбинирование
4. Дифф-вьюер, timeline версий, restore workflows
5. State management (React Query + Zustand/Redux)
6. i18n (рус/англ/исп/укр), темing, доступность (WCAG)
7. Advanced: формулы для тихих часов, network rules, notifications

### Этап E. CLI & Utilities (5k строк)
1. CLI (airsync status/pause/resume/sync/export/import)
2. Background agent на уровне OS (Launchd, Task Scheduler)
3. Diagnostics bundle, лог-экспорт, health-checks
4. Telemetry (opt-in), crash reporting, feature flags

### Этап F. Тестирование (10–12k строк)
1. Unit 90%: watcher, diff, crypto, scheduling
2. Integration: macOS↔Windows, case sensitivity, offline/online, SSID
3. End-to-End: Playwright UI, pairing, conflict resolution
4. Нагрузка: k6/gatling, high-latency, DDoS simulation (packet loss, jitter)
5. Security testing: MITM, replay, brute-force, code injection, API fuzzing
6. Regression & snapshot tests (golden)

### Этап G. Security Hardening
1. Threat model (STRIDE, LINDDUN), attack scenarios
2. Input validation & sanitization, path traversal defense
3. Secrets в secure storage (Keychain/DPAPI)
4. Integrity checks (signed updates, hash validation)
5. Audit trails, tamper-resistant logs
6. Incident response flow (lockout, quarantine)

### Этап H. Документация & OSS
1. README (features, quickstart, screenshots)
2. CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md
3. ADR (арх. решения), DEBT.md, CHANGELOG automation
4. CI/CD (GitHub Actions: lint/test/build/release)
5. Packaging: dmg, pkg, msi, winget, homebrew tap
6. License compliance + third-party notices

## 3. Технологический стэк (выбор)
- TypeScript 5.x, Node 20 LTS
- React 18 + MUI + React Query
- Electron 30 + contextIsolation + secure preload
- Chokidar + low-level bindings (node-addon-api)
- WebRTC (wrtc/simple-peer) + Socket.IO fallback
- Crypto: libsodium.js / Node crypto (AES-256-GCM, Curve25519)
- Testing: Jest, Playwright, Vitest, k6, Toxiproxy
- Logging: Winston, Pino для CLI

## 4. Управление проектом
- Module ownership (Core, Networking, UI, Sec)
- Feature flags & experimental toggles
- Release branching: main/dev/release, semver
- Monitoring bundle (OpenTelemetry, Sentry)

## 5. Метрики готовности
- Функциональные: 100% покрытие требований ТЗ
- Кодовая база: 55–60k строк (TS/TSX)
- Покрытие тестами ≥ 90% новых модулей
- LCP < 2.5s, p95 sync latency < 200ms, CPU idle < 5%
- Security: все high/critical уязвимости устранены
- Документация: полный OSS пакет, build one-command

## 6. Следующие шаги
1. Подробный backlog по эпикам (A–H)
2. Выбор библиотек/обвязки для low-level API (fsevents, win32)
3. Прототипирование Watcher/Diff (спайки)
4. Threat modeling воркшоп, список атак тестов
5. Развернуть CI baseline (lint+test)

