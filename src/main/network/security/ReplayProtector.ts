const MAX_WINDOW_MS = 5 * 60 * 1000;

export class ReplayProtector {
  private readonly seen = new Map<string, number>();

  isReplay(nonce: string, timestamp: number): boolean {
    const now = Date.now();
    if (now - timestamp > MAX_WINDOW_MS) {
      return true;
    }

    const seenAt = this.seen.get(nonce);
    if (seenAt && now - seenAt < MAX_WINDOW_MS) {
      return true;
    }

    this.seen.set(nonce, now);
    return false;
  }
}
