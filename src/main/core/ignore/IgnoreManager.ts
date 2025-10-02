import * as fs from 'fs/promises';
import * as path from 'path';
import { PatternCompiler, IgnorePattern } from './PatternCompiler';

export interface IgnoreManagerOptions {
  presets: Record<string, string[]>;
  respectGitIgnore: boolean;
}

export class IgnoreManager {
  private readonly compiler = new PatternCompiler();
  private readonly cache: Map<string, IgnorePattern[]> = new Map();

  constructor(private readonly options: IgnoreManagerOptions) {}

  async loadPatterns(folderPath: string, additional: string[] = []): Promise<void> {
    const patterns: string[] = [];

    if (this.options.respectGitIgnore) {
      const gitignore = path.join(folderPath, '.gitignore');
      try {
        const content = await fs.readFile(gitignore, 'utf-8');
        patterns.push(...content.split(/\r?\n/));
      } catch (error) {
        // no gitignore
      }
    }

    const stignore = path.join(folderPath, '.stignore');
    try {
      const content = await fs.readFile(stignore, 'utf-8');
      patterns.push(...content.split(/\r?\n/));
    } catch (error) {
      // no stignore
    }

    patterns.push(...additional);

    const compiled = this.compiler.compile(patterns);
    this.cache.set(folderPath, compiled);
  }

  isIgnored(folderPath: string, targetPath: string): boolean {
    const patterns = this.cache.get(folderPath);
    if (!patterns) {
      return false;
    }

    const relative = path.relative(folderPath, targetPath);
    let ignored = false;

    for (const pattern of patterns) {
      if (pattern.matcher(relative)) {
        ignored = !pattern.isNegated;
      }
    }

    return ignored;
  }

  getPreset(name: string): string[] {
    return this.options.presets[name] ?? [];
  }
}
