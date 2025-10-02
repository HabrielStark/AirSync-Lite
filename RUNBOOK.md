# 🚨 AirSync-Lite Runbook

Emergency response and operational procedures.

---

## 🔴 Incident Response

### 1. Key Leak / Credential Compromise

**Symptoms**: Unauthorized device pairing, unexpected file access

**Immediate Actions**:
1. Pause all sync operations:
   ```bash
   airsync-lite pause
   ```

2. Revoke compromised device:
   - Open Settings → Devices
   - Remove untrusted device
   - Or via CLI:
   ```bash
   airsync-lite export-config > config-backup.json
   # Edit config-backup.json, remove device from 'devices' array
   airsync-lite import-config config-backup.json
   ```

3. Rotate secrets:
   - SecureChannel keys are stored in `userData/keys/`
   - Delete keys to force regeneration:
   ```bash
   rm -rf ~/.config/airsync-lite/keys/*
   ```
   - Restart app, re-pair all devices

4. Audit logs:
   ```bash
   grep "pairing" ~/.config/airsync-lite/logs/*.log
   ```

**Prevention**:
- Enable rate limiting (built-in)
- Use strong 6-digit pairing codes
- Review paired devices regularly

---

### 2. DDoS / Network Flood

**Symptoms**: High CPU/network usage, app unresponsive

**Immediate Actions**:
1. Check network activity:
   ```bash
   # Windows
   netstat -an | Select-String "ESTABLISHED"
   
   # Linux/macOS
   netstat -an | grep ESTABLISHED | wc -l
   ```

2. Enable firewall rules (if not already):
   - Allow only trusted IP ranges
   - Block suspicious peers in Settings → Network

3. Restart with rate limiting (built-in):
   ```bash
   airsync-lite resume
   ```

4. Check intrusion detection logs:
   ```bash
   grep "intrusion" ~/.config/airsync-lite/logs/*.log
   ```

**Mitigation**:
- Intrusion detection auto-blocks suspicious peers
- Rate limiter (10 req/min per peer)
- Connection limit (configurable)

---

### 3. Cryptominer / Malware on Peer

**Symptoms**: Unusual file activity, unexpected CPU spikes, sync delays

**Immediate Actions**:
1. Pause sync immediately:
   ```bash
   airsync-lite pause
   ```

2. Quarantine affected folder:
   - Temporarily remove folder from sync
   - Scan with antivirus

3. Review file history:
   - Open History page
   - Filter by suspicious device
   - Restore clean versions:
   ```bash
   airsync-lite restore <version-id> <target-path>
   ```

4. Unpair infected device:
   - Settings → Devices → Remove

**Prevention**:
- Use `.syncignore` to exclude executables:
   ```
   *.exe
   *.bat
   *.ps1
   *.sh
   ```
- Enable version history (enabled by default)

---

### 4. Dependency CVE / Supply-Chain Attack

**Symptoms**: npm audit warnings, GitHub Dependabot alerts

**Immediate Actions**:
1. Run audit:
   ```bash
   npm audit --production
   ```

2. Check SBOM:
   ```bash
   cat sbom.json | grep -A 5 "<vulnerable-package>"
   ```

3. Update vulnerable deps:
   ```bash
   npm update <package>@<safe-version> --save-exact
   npm run build
   npm test
   ```

4. If critical:
   - Stop app distribution
   - Notify users via GitHub Release notes
   - Issue patched version within 24h

**Prevention**:
- CI checks dependencies on every PR
- Dependabot auto-updates minor versions
- All deps pinned with exact versions

---

### 5. Stripe Fraud Alert (If Applicable)

**Symptoms**: Unusual payment activity, leaked API keys

**Immediate Actions**:
1. Rotate Stripe keys immediately:
   - Log in to Stripe Dashboard
   - API Keys → Roll key
   - Update in keychain:
   ```bash
   airsync-lite set-secret STRIPE_SECRET_KEY sk_live_...
   ```

2. Enable additional fraud detection:
   - Stripe Radar rules
   - IP allowlists

3. Notify affected customers

**Prevention**:
- Store keys in OS keychain (implemented)
- Use restricted API keys (scope to minimum required)
- Enable webhook signature verification (required)

---

## 📊 Health Checks

### Application Health

```bash
# Check if running
ps aux | grep airsync-lite

# Check sync status
airsync-lite status

# View recent logs
tail -n 50 ~/.config/airsync-lite/logs/main.log
```

### Database Integrity

```bash
# Check SQLite metadata store
sqlite3 ~/.config/airsync-lite/versions.db "PRAGMA integrity_check;"
```

### Network Connectivity

```bash
# Test discovery
airsync-lite status | grep "Discovered peers"

# Check peer connections
grep "peer-connected" ~/.config/airsync-lite/logs/*.log
```

---

## 🔧 Recovery Procedures

### Restore from Version History

```bash
# List versions
airsync-lite history <file-path>

# Restore specific version
airsync-lite restore <version-id> <target-path>
```

### Reset to Factory Settings

```bash
# Backup config first
airsync-lite export-config > backup-$(date +%Y%m%d).json

# Clear all data
rm -rf ~/.config/airsync-lite/*

# Restart app, run onboarding
```

### Rebuild Database

```bash
# Stop app
airsync-lite pause

# Backup
cp ~/.config/airsync-lite/versions.db versions.db.bak

# Rebuild (if corrupt)
sqlite3 ~/.config/airsync-lite/versions.db "VACUUM;"

# Restart
airsync-lite resume
```

---

## 📞 Escalation Contacts

- **Security Issues**: security@airsync-lite.local (see SECURITY.md)
- **Technical Support**: GitHub Issues
- **Critical Incidents**: On-call engineer (if applicable)

---

## 📚 Related Documentation

- `SECURITY.md` — Security policy & reporting
- `KNOWN_LIMITATIONS.md` — Known security issues
- `BUILD.md` — Build & deployment
- `RELEASE_CHECKLIST.md` — Pre-release verification

---

**Last Updated**: 2025-01-XX  
**Maintained By**: Engineering Team
