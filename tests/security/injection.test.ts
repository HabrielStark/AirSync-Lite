import { describe, it, expect } from '@jest/globals';

describe('Input Sanitization', () => {
  const maliciousInputs = [
    '../../../etc/passwd',
    '../../../../Windows/System32',
    '<script>alert("XSS")</script>',
    '"; DROP TABLE users; --',
    '${process.env.SECRET}',
    '{{constructor.constructor("return process")()}}',
    '`rm -rf /`',
    'test\x00.txt',
  ];

  it('should reject path traversal attempts', () => {
    maliciousInputs.forEach(input => {
      const sanitized = sanitizePath(input);
      expect(sanitized).not.toContain('..');
      expect(sanitized).not.toContain('\\');
    });
  });

  it('should sanitize HTML/XML entities', () => {
    const htmlInjection = '<img src=x onerror="alert(1)">';
    const sanitized = sanitizeHtml(htmlInjection);
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onerror');
  });

  it('should reject SQL injection patterns', () => {
    const sqlInjection = "' OR '1'='1";
    const sanitized = sanitizeSql(sqlInjection);
    expect(sanitized).not.toContain("'");
    expect(sanitized).not.toContain('OR');
  });

  it('should reject command injection', () => {
    const cmdInjection = '"; cat /etc/passwd #';
    const sanitized = sanitizeCommand(cmdInjection);
    expect(sanitized).not.toContain(';');
    expect(sanitized).not.toContain('&');
    expect(sanitized).not.toContain('|');
  });

  it('should handle unicode normalization attacks', () => {
    const unicodeBypass = 'аdmin'; // Cyrillic 'a'
    const normalized = normalizeUnicode(unicodeBypass);
    expect(normalized).not.toBe('admin');
  });
});

// Helper functions (implement in actual code)
function sanitizePath(input: string): string {
  return input.replace(/\.\./g, '').replace(/\\/g, '/');
}

function sanitizeHtml(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeSql(input: string): string {
  return input.replace(/[';]/g, '');
}

function sanitizeCommand(input: string): string {
  return input.replace(/[;&|`$()]/g, '');
}

function normalizeUnicode(input: string): string {
  return input.normalize('NFKC');
}
