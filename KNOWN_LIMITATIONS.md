# Known Limitations & Security Considerations

## Supply-Chain Security

### NAT Traversal Library (nat-api@0.3.1)
**Status**: Critical CVE  
**Issue**: Depends on deprecated `request` package with prototype pollution vulnerabilities:
- form-data <2.5.4 (critical)
- tough-cookie <4.1.3 (moderate)
- xml2js <0.5.0 (moderate)

**Mitigation Options**:
1. Replace with direct `nat-pmp` + `nat-upnp` implementation
2. Make NAT traversal optional (use relay/TURN only)
3. Fork and update dependencies

**Current Status**: Feature works but uses vulnerable dependencies. **Not recommended for production without mitigation.**

---

## Pairing Security

### Code Generation
**Issue**: `PairingService.generateCode()` uses `Math.random()` instead of crypto-secure PRNG.

**Fix Required**:
```typescript
generateCode(): string {
  return crypto.randomInt(100000, 999999).toString().padStart(6, '0');
}
```

---

## Content Security Policy

### Current CSP (Fixed)
- Removed `'unsafe-inline'` from scripts
- Kept external fonts for Material UI
- Added WebSocket connections for sync

**Note**: MUI uses inline styles. If stricter CSP needed, consider:
- Using `nonce` for inline styles
- Migrating to styled-components with CSP support

---

## Versioning

### SQLite Store
- New `SQLiteMetadataStore` created but not yet fully integrated in all flows
- Original JSON-based `VersionManager` in `src/main/sync` still primary
- Both systems coexist; recommend consolidation

---

## Testing

### Coverage: ~20%
- Unit tests: 3 files (watcher, cliBridge)
- Integration tests: 1 file (pairing - partial)
- E2E tests: 1 file (onboarding - UI only)
- Security tests: 1 file (MITM - empty stub)
- Load tests: 1 file (k6 - minimal)

**Target**: 85%+ coverage needed for production.

---

## Assets

### Missing Resources
- Application icons (icon.png, icon.ico, icon.icns)
- Tray icons for all states (syncing, paused, error, offline)
- Dark mode tray variants (macOS)

**Status**: Placeholder entitlements.plist created, but icons needed for distribution builds.

---

## CI/CD

### GitHub Actions
- Workflow file created (`.github/workflows/ci.yml`)
- Actions pinned by SHA for security
- Includes lint, test, audit, SBOM generation, multi-platform builds

**Status**: Ready to use once repository is pushed to GitHub.

---

## Production Readiness Checklist

- [x] Supply-chain dependencies pinned
- [x] Core network transfer implemented
- [x] Versioning with persistence
- [x] Pairing & encryption (RSA+AES)
- [x] UI toast notifications
- [~] CSP hardened (fonts still external)
- [ ] NAT-API CVEs mitigated
- [ ] Pairing uses crypto-secure random
- [ ] Test coverage ≥85%
- [ ] All icons/assets created
- [ ] Secrets moved to OS keychain
- [ ] Security tests passing
- [ ] E2E tests covering full flows

**Estimated completion**: 2-3 weeks additional development.

---

*Last updated: 2025-09-29*
