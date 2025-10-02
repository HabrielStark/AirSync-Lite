import * as path from 'path';
import * as fs from 'fs/promises';
import ignore, { Ignore } from 'ignore';
import { logger } from './logger';

export class IgnoreParser {
  private ig: Ignore;
  private patterns: Set<string> = new Set();
  private gitIgnorePatterns: Set<string> = new Set();

  constructor() {
    this.ig = ignore();
  }

  async loadFromFolder(folderPath: string): Promise<void> {
    try {
      // Load .stignore file
      const stignorePath = path.join(folderPath, '.stignore');
      await this.loadIgnoreFile(stignorePath, false);

      // Recursively load .stignore files from subdirectories
      await this.loadSubdirectoryIgnores(folderPath, folderPath);
    } catch (error) {
      logger.warn(`Failed to load ignore files from ${folderPath}:`, error);
    }
  }

  async loadGitIgnore(folderPath: string): Promise<void> {
    try {
      const gitignorePath = path.join(folderPath, '.gitignore');
      await this.loadIgnoreFile(gitignorePath, true);
    } catch (error) {
      // .gitignore might not exist, which is fine
    }
  }

  private async loadIgnoreFile(filePath: string, isGitIgnore: boolean = false): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const patterns = this.parseIgnoreContent(content);

      patterns.forEach((pattern) => {
        if (isGitIgnore) {
          this.gitIgnorePatterns.add(pattern);
        } else {
          this.patterns.add(pattern);
        }
      });

      this.rebuildIgnore();
    } catch (error) {
      // File might not exist, which is fine
    }
  }

  private async loadSubdirectoryIgnores(rootPath: string, currentPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPath = path.join(currentPath, entry.name);
          const relativePath = path.relative(rootPath, subPath);

          // Skip if this directory is already ignored
          if (this.isIgnored(relativePath)) {
            continue;
          }

          // Check for .stignore in subdirectory
          const subStignorePath = path.join(subPath, '.stignore');
          try {
            const content = await fs.readFile(subStignorePath, 'utf-8');
            const patterns = this.parseIgnoreContent(content);

            // Prefix patterns with the subdirectory path
            patterns.forEach((pattern) => {
              const prefixedPattern = path.join(relativePath, pattern).replace(/\\/g, '/');
              this.patterns.add(prefixedPattern);
            });

            this.rebuildIgnore();
          } catch (error) {
            // No .stignore in this subdirectory
          }

          // Recursively check subdirectories
          await this.loadSubdirectoryIgnores(rootPath, subPath);
        }
      }
    } catch (error) {
      logger.warn(`Failed to load subdirectory ignores from ${currentPath}:`, error);
    }
  }

  private parseIgnoreContent(content: string): string[] {
    const lines = content.split(/\r?\n/);
    const patterns: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Handle special syntax
      let pattern = trimmed;

      // Convert Windows paths to Unix-style
      pattern = pattern.replace(/\\/g, '/');

      patterns.push(pattern);
    }

    return patterns;
  }

  addPatterns(patterns: string[]): void {
    patterns.forEach((pattern) => this.patterns.add(pattern));
    this.rebuildIgnore();
  }

  clearPatterns(): void {
    this.patterns.clear();
    this.gitIgnorePatterns.clear();
    this.rebuildIgnore();
  }

  private rebuildIgnore(): void {
    this.ig = ignore();

    // Add all patterns
    const allPatterns = [...this.patterns, ...this.gitIgnorePatterns];
    if (allPatterns.length > 0) {
      this.ig.add(allPatterns);
    }

    // Always ignore .stignore files themselves
    this.ig.add('.stignore');

    // Always ignore system files
    this.ig.add([
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',
      '._*',
      '.Spotlight-V100',
      '.Trashes',
      'ehthumbs.db',
      '~$*',
    ]);
  }

  isIgnored(relativePath: string): boolean {
    // Normalize path separators
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // Check if path or any parent directory is ignored
    const parts = normalizedPath.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const partialPath = parts.slice(0, i).join('/');
      if (this.ig.ignores(partialPath)) {
        return true;
      }
    }

    return false;
  }

  getPatterns(): string[] {
    return Array.from(this.patterns);
  }

  getGitIgnorePatterns(): string[] {
    return Array.from(this.gitIgnorePatterns);
  }

  getAllPatterns(): string[] {
    return [...this.patterns, ...this.gitIgnorePatterns];
  }

  // Default ignore patterns based on tech stack
  static getPresetPatterns(techStack: string): string[] {
    const presets: Record<string, string[]> = {
      general: [
        '.DS_Store',
        'Thumbs.db',
        '*.log',
        '*.tmp',
        '*.temp',
        '*.cache',
        '.vscode/',
        '.idea/',
        '*.iml',
        '.vs/',
        '*.suo',
        '*.user',
        '*.userosscache',
        '*.sln.docstates',
      ],
      node: [
        'node_modules/',
        'dist/',
        'build/',
        '.build/',
        '.next/',
        '.nuxt/',
        'out/',
        'coverage/',
        '.nyc_output/',
        '*.tsbuildinfo',
        '.cache/',
        '.parcel-cache/',
        '.turbo/',
        'bower_components/',
        'jspm_packages/',
        'web_modules/',
        '.npm/',
        '.yarn/',
        '.pnp.*',
        'npm-debug.log*',
        'yarn-debug.log*',
        'yarn-error.log*',
        'lerna-debug.log*',
        '.env',
        '.env.*',
        '!.env.example',
      ],
      python: [
        '__pycache__/',
        '*.py[cod]',
        '*$py.class',
        '*.so',
        '.Python',
        'build/',
        'develop-eggs/',
        'dist/',
        'downloads/',
        'eggs/',
        '.eggs/',
        'lib/',
        'lib64/',
        'parts/',
        'sdist/',
        'var/',
        'wheels/',
        'pip-wheel-metadata/',
        'share/python-wheels/',
        '*.egg-info/',
        '*.egg',
        'MANIFEST',
        '.venv/',
        'venv/',
        'ENV/',
        'env/',
        '.pytest_cache/',
        '.mypy_cache/',
        '.dmypy.json',
        'dmypy.json',
        '.pyre/',
        '.pytype/',
        'cython_debug/',
        '.coverage',
        '.coverage.*',
        'htmlcov/',
        '.tox/',
        '.nox/',
        '.hypothesis/',
        'instance/',
        '.webassets-cache',
        '.scrapy',
        'docs/_build/',
        '.ipynb_checkpoints',
        'profile_default/',
        'ipython_config.py',
        '__pypackages__/',
        'celerybeat-schedule',
        'celerybeat.pid',
        '*.sage.py',
        '.env',
        '.env.*',
      ],
      django: [
        '*.sqlite3',
        '*.sqlite3-journal',
        'local_settings.py',
        'db.sqlite3',
        'db.sqlite3-journal',
        'media/',
        'staticfiles/',
        '_static/',
        '_media/',
      ],
      flutter: [
        '.dart_tool/',
        '.packages',
        '.pub-cache/',
        '.pub/',
        'build/',
        'coverage/',
        'doc/api/',
        'doc/api.json',
        '.flutter-plugins',
        '.flutter-plugins-dependencies',
        '*.iml',
        '*.ipr',
        '*.iws',
        '.metadata',
        '.melos_tool/',
        'pubspec.lock',
      ],
      ios: [
        'Pods/',
        '*.xcworkspace/',
        '*.xcodeproj/xcuserdata/',
        '*.xcodeproj/project.xcworkspace/',
        '*.xcuserstate',
        '*.xcuserdatad/',
        'DerivedData/',
        '*.moved-aside',
        '*.pbxuser',
        '*.mode1v3',
        '*.mode2v3',
        '*.perspectivev3',
        '*.xccheckout',
        '*.xcscmblueprint',
        '*.hmap',
        '*.ipa',
        '*.dSYM.zip',
        '*.dSYM',
        'timeline.xctimeline',
        'playground.xcworkspace',
        '.build/',
        'Carthage/Build/',
        'Dependencies/',
        '.accio/',
        'fastlane/report.xml',
        'fastlane/Preview.html',
        'fastlane/screenshots/**/*.png',
        'fastlane/test_output',
        'iOSInjectionProject/',
      ],
      android: [
        '*.iml',
        '.gradle/',
        'local.properties',
        '.idea/',
        '*.ipr',
        '*.iws',
        '.DS_Store',
        'build/',
        'captures/',
        '.externalNativeBuild/',
        '.cxx/',
        '*.apk',
        '*.aab',
        '*.ap_',
        '*.dex',
        '*.class',
        'bin/',
        'gen/',
        'out/',
        'release/',
        'proguard/',
        '*.log',
        '.navigation/',
        '**/build/',
        'google-services.json',
        '*.jks',
        '*.keystore',
      ],
      unity: [
        'Library/',
        'Temp/',
        'Obj/',
        'Build/',
        'Builds/',
        'Logs/',
        'MemoryCaptures/',
        'UserSettings/',
        '*.csproj',
        '*.unityproj',
        '*.sln',
        '*.suo',
        '*.tmp',
        '*.user',
        '*.userprefs',
        '*.pidb',
        '*.booproj',
        '*.svd',
        '*.pdb',
        '*.mdb',
        '*.opendb',
        '*.VC.db',
        '*.pidb.meta',
        '*.pdb.meta',
        '*.mdb.meta',
        'sysinfo.txt',
        '*.apk',
        '*.aab',
        '*.unitypackage',
        '*.app',
        'crashlytics-build.properties',
        '/[Aa]ssets/AssetStoreTools*',
        '/[Aa]ssets/Plugins/Editor/JetBrains*',
        '.gradle/',
        'ExportedObj/',
        '.consulo/',
        '.vs/',
        '.vscode/',
      ],
      unreal: [
        'Binaries/',
        'DerivedDataCache/',
        'Intermediate/',
        'Saved/',
        '*.VC.db',
        '*.opensdf',
        '*.opendb',
        '*.sdf',
        '*.sln',
        '*.suo',
        '*.xcodeproj',
        '*.xcworkspace',
        '.vs/',
        '*.VC.opendb',
        'Build/',
        '!Build/**/*.ico',
        '!Build/**/*.icns',
        '*.app',
        '*.exe',
        '*.dll',
        '*.pdb',
        '*.target',
        '*.dylib',
        '*.so',
        '*.a',
        '*.lib',
        '*.uproject',
        '*.slo',
        '*.lo',
        '*.o',
        '*.obj',
        '*.gch',
        '*.pch',
        '*.lai',
        '*.la',
        '*.out',
        'Plugins/*/Binaries/',
        'Plugins/*/Intermediate/',
      ],
    };

    const patterns: string[] = [...presets.general];

    if (presets[techStack]) {
      patterns.push(...presets[techStack]);
    }

    return [...new Set(patterns)]; // Remove duplicates
  }
}
