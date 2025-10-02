import * as path from 'path';
import { logger } from './logger';

/**
 * Security utility for path validation and sanitization
 * Prevents path traversal attacks
 */

/**
 * Sanitizes a file path and ensures it stays within the base directory
 * @param filePath - The file path to sanitize (can be relative or absolute)
 * @param baseDir - The base directory that the path must stay within
 * @returns Sanitized absolute path
 * @throws Error if path traversal is detected
 */
export function sanitizePath(filePath: string, baseDir: string): string {
  // Normalize the base directory (resolve to absolute path)
  const normalizedBase = path.resolve(baseDir);

  // Normalize and resolve the file path
  const normalized = path.normalize(filePath);
  const resolved = path.resolve(normalizedBase, normalized);

  // Check if resolved path is within base directory
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    logger.error(
      `Path traversal attempt detected: ${filePath} (resolved: ${resolved}, base: ${normalizedBase})`
    );
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  return resolved;
}

/**
 * Validates that a path does not contain directory traversal patterns
 * @param filePath - The file path to validate
 * @returns true if path is safe, false otherwise
 */
export function isPathSafe(filePath: string): boolean {
  // Check for obvious traversal patterns
  const dangerousPatterns = [
    /\.\./, // ..
    /~\//, // ~/
    /^\/etc\//i, // /etc/ (absolute system path)
    /^\/usr\//i, // /usr/
    /^\/sys\//i, // /sys/
    /^\/proc\//i, // /proc/
    /^\/dev\//i, // /dev/
    /^c:\\/i, // C:\ (Windows system drive)
    /^%.*%/, // %APPDATA% etc (environment variables)
    /^\$\{.*\}/, // ${VAR} (variable interpolation)
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Extracts the relative path from an absolute path within a base directory
 * @param absolutePath - The absolute path
 * @param baseDir - The base directory
 * @returns Relative path from base directory
 * @throws Error if path is not within base directory
 */
export function getRelativePath(absolutePath: string, baseDir: string): string {
  const normalizedBase = path.resolve(baseDir);
  const normalizedPath = path.resolve(absolutePath);

  if (!normalizedPath.startsWith(normalizedBase + path.sep) && normalizedPath !== normalizedBase) {
    throw new Error(`Path ${absolutePath} is not within base directory ${baseDir}`);
  }

  return path.relative(normalizedBase, normalizedPath);
}

/**
 * Validates a file path for sync operations
 * Combines multiple security checks
 * @param filePath - The file path to validate
 * @param baseDir - The base directory for sync operations
 * @returns Sanitized absolute path
 * @throws Error if validation fails
 */
export function validateSyncPath(filePath: string, baseDir: string): string {
  // First check for obvious dangerous patterns
  if (!isPathSafe(filePath)) {
    throw new Error(`Unsafe path detected: ${filePath}`);
  }

  // Then sanitize and ensure it's within base directory
  return sanitizePath(filePath, baseDir);
}
