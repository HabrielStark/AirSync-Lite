# Модель угроз AirSync-Lite

## STRIDE анализ
- **Spoofing**: подмена устройства при pairing; защита — mutual auth, публичные ключи
- **Tampering**: изменение файлов по пути; защита — версии, hash, журнал
- **Repudiation**: отрицание действий; защита — аудиt логов, привязка к устройствам
- **Information disclosure**: перехват трафика; защита — TLS/WebRTC, AES-GCM
- **Denial of service**: flood трафик; защита — rate limiting, очереди
- **Elevation of privilege**: доступ к UI; защита — пароль UI, lock timeout

## Сценарии атак
1. MITM между устройствами → проверка сертификатов, подписи сообщений
2. brute-force pairing code → rate limit, lockout
3. replay sync payload → временные метки и nonce
4. path traversal → нормализация путей, запрет `..`
5. DDoS → лимиты на connections, backpressure

## Security контролы
- Подпись каждого payload (ed25519)
- AES-256-GCM + re-key на 1GB
- Хранение ключей в Keychain/DPAPI
- CI: SAST (npm audit, trivy)
- Incident response: force pause, revoke pairing
