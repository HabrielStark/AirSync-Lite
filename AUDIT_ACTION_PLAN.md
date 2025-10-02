# 🎯 AUDIT ACTION PLAN — Priority-Ordered Fixes

**Based On**: COMPREHENSIVE_AUDIT_REPORT.md  
**Created**: 2025-09-30  
**Target Completion**: 2025-10-07 (1 week)

---

## 🚨 PHASE 1: CRITICAL SECURITY FIXES (24-48 hours)

### Task 1.1: Fix Command Injection in Diff Tool Handler ⛔ BLOCKING
**File**: `src/main/ipc/handlers.ts:294-315`  
**Effort**: 30 minutes  
**Assignee**: Backend Engineer  

**Changes Required**:
```typescript
// Add path validation before spawn
import { validateSyncPath } from '../utils/pathSecurity';
import { app } from 'electron';

ipcMainInstance.handle('files:openDiff', async (_event, filePath1: string, filePath2: string) => {
  try {
    // Validate paths
    const validatedPath1 = validateSyncPath(filePath1, app.getPath('home'));
    const validatedPath2 = validateSyncPath(filePath2, app.getPath('home'));
    
    const diffTools = [
      { name: 'code', args: ['--diff'] },
      { name: 'meld', args: [] },
      { name: 'kdiff3', args: [] },
      { name: 'bcompare', args: [] },
      { name: 'winmerge', args: [] },
    ];

    for (const tool of diffTools) {
      try {
        const childProcess = await import('child_process');
        childProcess.spawn(tool.name, [...tool.args, validatedPath1, validatedPath2], {
          shell: false,  // CRITICAL: Prevent shell injection
          stdio: 'ignore',
        });
        return true;
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('No diff tool found');
  } catch (error) {
    throw new Error(`Path validation failed: ${error.message}`);
  }
});
```

**Test**:
```typescript
// Add to tests/security/injection.test.ts
describe('Command Injection Prevention', () => {
  it('should block malicious paths in diff tool', async () => {
    const maliciousPath = '../../../etc/passwd; rm -rf /';
    await expect(
      electronAPI.openInDiffTool(maliciousPath, '/valid/path')
    ).rejects.toThrow('Path validation failed');
  });
});
```

**Acceptance Criteria**:
- [x] Path validation added
- [x] `shell: false` option set
- [x] Test coverage for malicious input
- [x] No regression in legitimate use

---

### Task 1.2: Replace Hardcoded Keychain Encryption Key 🔴 HIGH
**File**: `src/main/utils/keychain.ts`  
**Effort**: 1 hour  
**Assignee**: Security Engineer  

**Changes Required**:
```typescript
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export class KeychainManager {
  private store: Store<KeychainStore>;
  private static readonly KEY_FILE = '.keychain.key';

  constructor() {
    const encryptionKey = this.getOrGenerateEncryptionKey();
    
    this.store = new Store<KeychainStore>({
      name: 'keychain',
      encryptionKey,
    });
  }

  private getOrGenerateEncryptionKey(): string {
    const keyPath = path.join(app.getPath('userData'), KeychainManager.KEY_FILE);
    
    try {
      if (fs.existsSync(keyPath)) {
        const key = fs.readFileSync(keyPath, 'utf8');
        if (key.length !== 64) {  // 32 bytes hex = 64 chars
          throw new Error('Invalid key length');
        }
        return key;
      }
    } catch (error) {
      logger.warn('Existing keychain key invalid, regenerating:', error);
    }
    
    // Generate new crypto-secure key
    const newKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, newKey, { 
      mode: 0o600,  // Read/write for owner only
      encoding: 'utf8' 
    });
    
    logger.info('Generated new keychain encryption key');
    return newKey;
  }
  
  // ... rest of class
}
```

**Migration Strategy**:
1. On upgrade, detect hardcoded key usage
2. Generate new key
3. Re-encrypt all secrets with new key
4. Delete old encrypted data after confirmation

**Acceptance Criteria**:
- [x] Unique key per installation
- [x] Key file permissions set to 0600
- [x] Automatic migration from old key
- [x] Logged security event on key generation

---

### Task 1.3: Upgrade Electron 29.1.5 → 32.x 🔴 HIGH
**Files**: `package.json`, `package-lock.json`  
**Effort**: 2-3 hours (includes testing)  
**Assignee**: Full-Stack Engineer  

**Steps**:
1. Check breaking changes: https://www.electronjs.org/docs/latest/breaking-changes
2. Update package.json:
   ```json
   "electron": "32.2.7"
   ```
3. Run: `npm install`
4. Test critical paths:
   - Window creation
   - IPC communication
   - Native modules (better-sqlite3)
   - Auto-updater
5. Update Electron Builder if needed
6. Full regression test suite

**Acceptance Criteria**:
- [x] Electron 32.x installed
- [x] All 68 tests passing
- [x] No console errors in dev mode
- [x] Build artifacts created successfully
- [x] E2E tests pass on Windows/macOS/Linux

---

## 🔧 PHASE 2: HIGH PRIORITY FIXES (2-3 days)

### Task 2.1: Replace crypto-js with Native Crypto ⚠️ MEDIUM
**Files**: Multiple (search for `crypto-js` imports)  
**Effort**: 3-4 hours  
**Assignee**: Backend Engineer  

**Current Usage**:
```bash
grep -r "crypto-js" src/
# (Check actual usage before migrating)
```

**If used, replace with**:
```typescript
// Old:
import CryptoJS from 'crypto-js';
const hash = CryptoJS.SHA256(data).toString();

// New:
import crypto from 'crypto';
const hash = crypto.createHash('sha256').update(data).digest('hex');
```

**Acceptance Criteria**:
- [x] All `crypto-js` imports removed
- [x] Native crypto equivalents implemented
- [x] Tests passing
- [x] No performance regression

---

### Task 2.2: Fix Self-Signed Certificate Generation ⚠️ MEDIUM
**File**: `src/main/network/secureChannel.ts:181-190`  
**Effort**: 1-2 hours  
**Assignee**: Backend Engineer  

**Solution 1: Use selfsigned package**:
```bash
npm install --save selfsigned
npm install --save-dev @types/selfsigned
```

```typescript
import selfsigned from 'selfsigned';

private generateSelfSignedCert(): Certificates {
  const attrs = [
    { name: 'commonName', value: this.deviceId },
    { name: 'organizationName', value: 'AirSync-Lite' }
  ];
  
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true
      }
    ]
  });
  
  return {
    key: pems.private,
    cert: pems.cert
  };
}
```

**Acceptance Criteria**:
- [x] Valid X.509 certificate generated
- [x] TLS handshake succeeds
- [x] Certificate stored/loaded correctly
- [x] Tests validate cert structure

---

### Task 2.3: Create .env.example ⚠️ MEDIUM
**File**: `.env.example` (new)  
**Effort**: 15 minutes  
**Assignee**: DevOps Engineer  

**Content** (see audit report for full template):
```dotenv
NODE_ENV=development
SYNC_PORT=40777
LOG_LEVEL=info
AUTO_UPDATE_URL=
HTTPS_PROXY=
NO_PROXY=localhost,127.0.0.1
ENABLE_DEVTOOLS=false
```

**Also Update**:
- `.gitignore`: Add `.env` (if not present)
- `README.md`: Add setup instructions

**Acceptance Criteria**:
- [x] `.env.example` created
- [x] All env vars documented
- [x] README updated
- [x] `.env` in `.gitignore`

---

### Task 2.4: Set Up GitHub Actions CI/CD ⚠️ MEDIUM
**File**: `.github/workflows/ci.yml` (new)  
**Effort**: 2-3 hours  
**Assignee**: DevOps Engineer  

**Workflow** (see audit report for complete YAML):

Key jobs:
1. `security-audit`: npm audit, SBOM, Trivy scan
2. `test`: Multi-platform (Ubuntu, Windows, macOS)
3. `build`: Create distributable artifacts

**Acceptance Criteria**:
- [x] CI runs on push/PR
- [x] All actions pinned by SHA
- [x] Multi-platform builds successful
- [x] Audit fails on critical vulns
- [x] Test coverage uploaded to Codecov

---

## 🎨 PHASE 3: LOW PRIORITY ENHANCEMENTS (Week 2)

### Task 3.1: Add Port Number Validation ⚠️ LOW
**File**: `src/pages/Settings.tsx:56-68`  
**Effort**: 30 minutes  

```typescript
const [portError, setPortError] = useState<string | null>(null);

<TextField
  label="Порт"
  value={config.schedules?.networkRules?.port ?? ''}
  error={!!portError}
  helperText={portError}
  onChange={(event) => {
    const port = parseInt(event.target.value);
    
    if (event.target.value && (isNaN(port) || port < 1 || port > 65535)) {
      setPortError('Port must be between 1 and 65535');
      return;
    }
    
    setPortError(null);
    updateConfig({
      schedules: {
        ...config.schedules,
        networkRules: {
          ...config.schedules?.networkRules,
          port,
        },
      },
    } as any);
  }}
/>
```

**Acceptance Criteria**:
- [x] Invalid ports rejected
- [x] User-friendly error message
- [x] Visual feedback (red border)

---

### Task 3.2: Add Secrets Report Mechanism ⚠️ LOW
**File**: `src/main/utils/keychain.ts`  
**Effort**: 1 hour  

Add `generateSecretsReport()` method (see audit report for implementation).

**Acceptance Criteria**:
- [x] Report includes all stored secrets
- [x] Shows encryption method
- [x] Lists required env vars
- [x] Security checks included

---

### Task 3.3: Create ATTRIBUTION.md ⚠️ LOW
**File**: `ATTRIBUTION.md` (new)  
**Effort**: 30 minutes  

**Content**:
```markdown
# Third-Party Licenses

This project uses the following open-source packages:

## Production Dependencies
- React (MIT) - https://reactjs.org
- Material-UI (MIT) - https://mui.com
- Electron (MIT) - https://electronjs.org
- socket.io (MIT) - https://socket.io
- better-sqlite3 (MIT) - https://github.com/WiseLibs/better-sqlite3

... (auto-generate from package.json)

## License Compliance
All dependencies are MIT, Apache-2.0, or BSD licensed.
See package.json and individual packages for full license text.
```

**Acceptance Criteria**:
- [x] All deps listed
- [x] Licenses identified
- [x] Links to projects
- [x] SPDX format considered

---

## 📊 PROGRESS TRACKING

**Overall Progress**: 0/13 tasks complete

### Critical (Phase 1): 0/3 ⛔
- [ ] Task 1.1: Command injection fix
- [ ] Task 1.2: Keychain encryption key
- [ ] Task 1.3: Electron upgrade

### High (Phase 2): 0/4 🔴
- [ ] Task 2.1: Replace crypto-js
- [ ] Task 2.2: Fix certificates
- [ ] Task 2.3: .env.example
- [ ] Task 2.4: CI/CD setup

### Low (Phase 3): 0/3 ⚠️
- [ ] Task 3.1: Port validation
- [ ] Task 3.2: Secrets report
- [ ] Task 3.3: ATTRIBUTION.md

---

## 📅 TIMELINE

**Week 1** (2025-09-30 to 2025-10-06):
- Mon-Tue: Phase 1 (Critical)
- Wed-Thu: Phase 2 (High)
- Fri: Testing & verification

**Week 2** (2025-10-07 to 2025-10-13):
- Mon: Phase 3 (Low priority)
- Tue-Wed: Full regression testing
- Thu: Security re-audit
- Fri: Production deployment preparation

---

## ✅ ACCEPTANCE GATES

**Phase 1 Complete When**:
- All critical tests passing
- Security scan clean
- Manual penetration test on command injection

**Phase 2 Complete When**:
- CI/CD pipeline operational
- All 68 tests + new tests passing
- Certificate generation validated

**Phase 3 Complete When**:
- All documentation updated
- Secrets report generated successfully
- Final audit clean

**Production Ready When**:
- All phases complete
- E2E tests pass on all platforms
- Code review approved
- Sign-off from Security, Engineering, DevOps

---

**[Progress: 0% — Next: Begin Phase 1]**

*This action plan is derived from the comprehensive audit. Update progress daily. Send 'status' to check progress.*
