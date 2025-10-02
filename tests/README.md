# План тестирования AirSync-Lite

## Юнит-тесты
- watcher: hash, snapshot, queue
- diff: rolling diff, delta encoder, patch applier
- networking: secure channel, message bus
- UI: render компонентов (React Testing Library)

## Интеграционные тесты
- macOS↔Windows путь (case-sensitivity, symlinks)
- Offline/online recovery
- Conflict resolution flow
- Pairing handshake

## E2E тесты (Playwright)
1. Onboarding → pairing → sync
2. Конфликт → выбор решения → восстановление версии

## Нагрузочные тесты (k6)
- 100 параллельных изменений
- Высокая задержка/потери (Toxiproxy)
- DDoS simulation (flood requests)

## Security тесты
- MITM (подмена сертификата)
- Replay атаки
- Brute-force pairing code
- Path traversal & injection
