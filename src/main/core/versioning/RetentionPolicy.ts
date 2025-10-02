export type VersionRetentionPolicy = SimpleRetentionPolicy | TimeBasedRetentionPolicy;

export interface SimpleRetentionPolicy {
  type: 'simple';
  keepVersions: number;
}

export interface TimeBasedRetentionPolicy {
  type: 'time-based';
  keepDays: number;
}

export function filterVersions<T extends { createdAt: number }>(
  versions: T[],
  policy: VersionRetentionPolicy
): T[] {
  if (policy.type === 'simple') {
    return versions.sort((a, b) => b.createdAt - a.createdAt).slice(0, policy.keepVersions);
  }

  const cutoff = Date.now() - policy.keepDays * 24 * 60 * 60 * 1000;
  return versions.filter((version) => version.createdAt >= cutoff);
}
