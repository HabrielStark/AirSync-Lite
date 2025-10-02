# Deletion Synchronization Design Draft

## Objectives
- Maintain a consistent view of folder contents across devices when files are deleted.
- Avoid accidental propagation of remote-only deletions to local-only files.
- Provide rollback hooks (via versioning) and audit trails for destructive operations.
- Respect folder modes (`send-receive`, `receive-only`) and user-selected policies (mirror/archive/manual).

## Terminology
- **Origin** – source of the last known valid copy (`local`, `remote`, `both`).
- **Deletion event** – removal of a file detected locally or reported by a peer.
- **FolderStateTracker** – persistent, per-folder catalog of file metadata and origin state.
- **Deletion policy** – operational rule: mirror (default), archive (stash before delete), manual (queue + user confirm).

## Architecture Overview

```
Watcher -> Tracker -> FolderStateTracker (local update)
         \
          -> SyncEngine.determineActions() -> TransferManager / DeletePipeline -> NetworkManager

NetworkManager
  <- delete-request/delete-ack protocol -> remote peers
  -> emits delete notifications to SyncEngine

VersionManager
  -> optional archive step before irreversible removal
```

### Components
1. **FolderStateTracker**
   - Stores `relativePath`, hashes, size, timestamps, origin flags, and pending-delete markers.
   - Persists on disk (`~/.airsync-lite/state/<folderId>.json`).
   - Exposes APIs:
     - `applyLocalScan(files)` / `applyRemoteSnapshot(peerId, files)`
     - `markDeleted(path, origin)`
     - `listPendingRemoteDeletes()` / `listPendingLocalDeletes()`
     - `commitDeletion(path)` to clear pending flags once ACK received.

2. **DeletionCoordinator (new module in syncEngine)**
   - Consumes tracker pending lists.
   - Emits `delete-request` messages via `NetworkManager.sendDelete()`.
   - Handles retries/timeouts, promotes to conflict if ack denied/timeout.

3. **Network Protocol Extensions**
   - `DeleteRequest { folderId, relativePath, originHash, timestamp, nonce }`
   - `DeleteAck { requestId, status: accepted|rejected, reason? }`
   - Signed using `SecureChannel` to prevent spoofing.
   - Replay protection reuses `ReplayProtector` with new message type identifier.

4. **VersionManager Integration**
   - When policy = `archive`, before local delete, push file data into version store.
   - Tag archived versions with `delete-request-id` for audit/restore.

5. **UI / IPC**
   - Tray + renderer show pending deletions, allow cancel (manual mode) or restore (archive).
   - IPC handlers expose `delete:listPending`, `delete:approve`, `delete:reject`.

## Workflow Summary

### Local Deletion Detected
1. Watcher emits `unlink`.
2. Tracker marks local deletion, sets `pendingRemoteDelete` if origin included remote.
3. DeletionCoordinator queues delete-requests for applicable peers (respecting folder mode).
4. NetworkManager sends request; TransferManager/VersionManager optionally archives local copy.
5. Upon `delete-ack` success, tracker `commitDeletion`; on failure/timeouts -> conflict queue.

### Remote Delete Request Received
1. NetworkManager validates signature + policy (receive-only -> auto accept; mirror -> apply).
2. SyncEngine executes local delete (with archive if configured).
3. Tracker updates entry, sets `pendingLocalDelete=false`, records `deletedAt`.
4. Ack returned; any failure surfaces as conflict requiring manual resolution.

## Policy Matrix

| Folder Mode / Policy | Remote Request | Local Delete |
|----------------------|----------------|--------------|
| send-receive + mirror| Auto-accept, delete | Propagate to peers |
| send-receive + archive| Archive -> delete -> ack | Archive -> broadcast |
| send-receive + manual | Queue for approval | Queue until confirm |
| receive-only           | Reject (log)       | No propagation |

## Failure Handling
- **Timeout**: retry exponential backoff, up to N attempts; escalate to conflict.
- **Mismatch Hash**: remote vs tracker hash mismatch -> request peer to send latest file (treat as conflict).
- **Offline Peers**: maintain pending queue; send once peer reconnects; implement expiry (configurable).
- **Rollback**: if deletion aborted, restore from `VersionManager` or remote copy (manual mode).

## Telemetry & Logs
- Log each delete request/ack with requestId, peerId, policy.
- Emit metrics: pending deletions, ack latency, failure counts.

## Open Questions
- Should snapshots include directory deletions separately? (todo)
- What minimum hash info is required when remote list lacks full metadata? (requires network list audit)
- UI/UX for manual approvals (batch vs single actions).

## Next Steps
1. Design `FolderStateTracker` data model and JSON schema.
2. Extract shared helpers (path normalization, origin merge) to reuse across modules.
3. Extend protocol definitions + message bus stubs (delete-request, delete-ack).
4. Implement tracker with read-only integration into `syncEngine.scanFolder`.
5. Build deletion coordinator behind feature flag; add unit/integration tests.

