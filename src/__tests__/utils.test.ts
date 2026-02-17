import { describe, it, expect } from 'vitest';
import { extractTextContent, formatBytes, truncate } from '../utils.js';

describe('extractTextContent', () => {
  it('returns string content as-is', () => {
    expect(extractTextContent('hello world')).toBe('hello world');
  });

  it('extracts text from content blocks', () => {
    const blocks = [
      { type: 'text', text: 'line 1' },
      { type: 'image', text: undefined },
      { type: 'text', text: 'line 2' },
    ];
    expect(extractTextContent(blocks)).toBe('line 1\nline 2');
  });

  it('returns empty string for non-string, non-array', () => {
    expect(extractTextContent(null as any)).toBe('');
  });

  it('handles empty array', () => {
    expect(extractTextContent([])).toBe('');
  });

  it('skips blocks without text', () => {
    const blocks = [
      { type: 'text' },
      { type: 'tool_use', text: 'ignored' },
    ];
    expect(extractTextContent(blocks as any)).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles exact-length strings', () => {
    expect(truncate('abcde', 5)).toBe('abcde');
  });
});
