import micromatch from 'micromatch';

export interface IgnorePattern {
  raw: string;
  isNegated: boolean;
  matcher: (target: string) => boolean;
}

export class PatternCompiler {
  compile(patterns: string[]): IgnorePattern[] {
    return patterns
      .map((pattern) => this.compilePattern(pattern))
      .filter((pattern) => pattern.matcher !== noopMatcher);
  }

  private compilePattern(pattern: string): IgnorePattern {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return {
        raw: pattern,
        isNegated: false,
        matcher: noopMatcher,
      };
    }

    const isNegated = trimmed.startsWith('!');
    const normalized = isNegated ? trimmed.slice(1) : trimmed;
    const glob = normalized.replace(/\\/g, '/');

    return {
      raw: pattern,
      isNegated,
      matcher: (target) => micromatch.isMatch(target.replace(/\\/g, '/'), glob, { dot: true }),
    };
  }
}

function noopMatcher(): boolean {
  return false;
}
