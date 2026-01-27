import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { glob } from 'glob';

export interface SessionMessage {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
  result?: {
    assistant?: string;
    error?: string;
  };
  timestamp?: string;
  [key: string]: unknown;
}

// V1 session format for batch analysis (different from v2 Session in types.ts)
export interface AnalysisSession {
  path: string;
  projectPath: string;
  messages: SessionMessage[];
  timestamp: Date;
}

export function getClaudeSessionsPath(): string {
  return process.env.CLAUDE_SESSIONS_PATH || join(homedir(), '.claude', 'projects');
}

export async function findSessions(limit?: number): Promise<AnalysisSession[]> {
  const basePath = getClaudeSessionsPath();
  
  if (!existsSync(basePath)) {
    throw new Error(`Claude sessions directory not found: ${basePath}`);
  }

  // Find all session JSONL files - try multiple patterns
  // Pattern 1: ~/.claude/projects/*/sessions/*.jsonl (older structure)
  // Pattern 2: ~/.claude/projects/*/*.jsonl (newer structure)
  const patterns = [
    join(basePath, '*', 'sessions', '*.jsonl'),
    join(basePath, '*', '*.jsonl')
  ];
  
  let files: string[] = [];
  for (const pattern of patterns) {
    const found = await glob(pattern);
    files = files.concat(found);
  }
  
  // Dedupe
  files = [...new Set(files)];
  
  // Parse and sort by modification time
  const sessions: AnalysisSession[] = [];
  
  for (const filePath of files) {
    try {
      const stat = statSync(filePath);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const messages: SessionMessage[] = [];
      
      for (const line of lines) {
        try {
          messages.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
      
      if (messages.length > 0) {
        // Extract project path from file path
        const projectPath = dirname(dirname(filePath));
        sessions.push({
          path: filePath,
          projectPath,
          messages,
          timestamp: stat.mtime
        });
      }
    } catch {
      // Skip unreadable files
    }
  }
  
  // Sort by most recent first
  sessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  return limit ? sessions.slice(0, limit) : sessions;
}

export function extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text!)
      .join('\n');
  }
  return '';
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
