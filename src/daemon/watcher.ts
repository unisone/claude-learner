/**
 * File Watcher for Claude Sessions
 * Uses @parcel/watcher for native C++ performance and historical queries
 */

import * as watcher from '@parcel/watcher';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Types
export interface WatcherEvent {
  type: 'session.created' | 'session.updated';
  sessionPath: string;
  projectPath: string;
  sessionId: string;
  timestamp: Date;
}

export interface WatcherSnapshot {
  savedAt: number;
  files: Record<string, { mtime: number; size: number }>;
}

export interface WatcherOptions {
  debounceMs?: number;
  snapshotPath?: string;
}

const SNAPSHOT_PATH = '/tmp/claude-learner-snapshot.json';
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * SessionWatcher - Watches ~/.claude/projects/ for session changes
 */
export class SessionWatcher extends EventEmitter {
  private subscription: watcher.AsyncSubscription | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number;
  private snapshotPath: string;
  private knownFiles: Map<string, { mtime: number; size: number }> = new Map();
  private isRunning = false;

  constructor(options: WatcherOptions = {}) {
    super();
    this.debounceMs = options.debounceMs ?? 500;
    this.snapshotPath = options.snapshotPath ?? SNAPSHOT_PATH;
  }

  /**
   * Start watching for session changes
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Watcher is already running');
    }

    // Ensure projects directory exists
    if (!fs.existsSync(PROJECTS_DIR)) {
      console.log(`📁 Creating projects directory: ${PROJECTS_DIR}`);
      fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    }

    // Load snapshot and detect changes since last run
    await this.loadSnapshot();
    await this.catchUpFromSnapshot();

    // Start watching
    this.subscription = await watcher.subscribe(
      PROJECTS_DIR,
      (err: Error | null, events: watcher.Event[]) => {
        if (err) {
          this.emit('error', err);
          return;
        }
        this.handleEvents(events);
      },
      {
        ignore: ['**/.git/**', '**/node_modules/**'],
      }
    );

    this.isRunning = true;
    this.emit('started');
    console.log(`👁️  Watching: ${PROJECTS_DIR}`);
  }

  /**
   * Stop watching and save snapshot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Unsubscribe from watcher
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }

    // Save snapshot for next startup
    await this.saveSnapshot();

    this.isRunning = false;
    this.emit('stopped');
    console.log('🛑 Watcher stopped');
  }

  /**
   * Handle raw file system events
   */
  private handleEvents(events: watcher.Event[]): void {
    for (const event of events) {
      // Only care about .jsonl files
      if (!event.path.endsWith('.jsonl')) {
        continue;
      }

      // Only care about creates and updates
      if (event.type !== 'create' && event.type !== 'update') {
        continue;
      }

      // Debounce to wait for writes to finish
      this.debouncedEmit(event.path, event.type === 'create');
    }
  }

  /**
   * Debounce events to wait for writes to complete
   */
  private debouncedEmit(filePath: string, isNew: boolean): void {
    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.emitSessionEvent(filePath, isNew);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Emit a session event
   */
  private emitSessionEvent(filePath: string, isNew: boolean): void {
    try {
      const stat = fs.statSync(filePath);
      const wasKnown = this.knownFiles.has(filePath);
      const eventType = !wasKnown || isNew ? 'session.created' : 'session.updated';

      // Update known files
      this.knownFiles.set(filePath, { mtime: stat.mtimeMs, size: stat.size });

      // Parse session info from path
      const relativePath = path.relative(PROJECTS_DIR, filePath);
      const parts = relativePath.split(path.sep);
      
      // Session files are like: {project-hash}/{session-id}.jsonl
      const sessionId = path.basename(filePath, '.jsonl');
      const projectHash = parts.length > 1 ? parts[0] : 'unknown';

      const event: WatcherEvent = {
        type: eventType,
        sessionPath: filePath,
        projectPath: path.dirname(filePath),
        sessionId,
        timestamp: new Date(),
      };

      this.emit(eventType, event);
      this.emit('session', event); // Generic event for all session changes
      
      console.log(`📝 ${eventType}: ${sessionId}`);
    } catch (err) {
      // File might have been deleted between detection and stat
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.emit('error', err);
      }
    }
  }

  /**
   * Load snapshot from disk
   */
  private async loadSnapshot(): Promise<void> {
    try {
      if (fs.existsSync(this.snapshotPath)) {
        const data = fs.readFileSync(this.snapshotPath, 'utf-8');
        const snapshot: WatcherSnapshot = JSON.parse(data);
        
        this.knownFiles = new Map(Object.entries(snapshot.files));
        console.log(`📸 Loaded snapshot with ${this.knownFiles.size} files (saved at ${new Date(snapshot.savedAt).toISOString()})`);
      }
    } catch (err) {
      console.warn('⚠️  Could not load snapshot, starting fresh');
      this.knownFiles = new Map();
    }
  }

  /**
   * Save snapshot to disk
   */
  async saveSnapshot(): Promise<void> {
    try {
      // Refresh known files with current state
      await this.scanExistingFiles();

      const snapshot: WatcherSnapshot = {
        savedAt: Date.now(),
        files: Object.fromEntries(this.knownFiles),
      };

      fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2));
      console.log(`💾 Saved snapshot with ${this.knownFiles.size} files`);
    } catch (err) {
      console.error('❌ Failed to save snapshot:', err);
    }
  }

  /**
   * Scan existing files and update known files map
   */
  private async scanExistingFiles(): Promise<Map<string, { mtime: number; size: number }>> {
    const files = new Map<string, { mtime: number; size: number }>();

    if (!fs.existsSync(PROJECTS_DIR)) {
      return files;
    }

    const scanDir = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            // Skip hidden directories
            if (!entry.name.startsWith('.')) {
              scanDir(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
              const stat = fs.statSync(fullPath);
              files.set(fullPath, { mtime: stat.mtimeMs, size: stat.size });
            } catch {
              // Ignore stat errors
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    };

    scanDir(PROJECTS_DIR);
    return files;
  }

  /**
   * Catch up on changes since last snapshot
   */
  private async catchUpFromSnapshot(): Promise<void> {
    const currentFiles = await this.scanExistingFiles();
    let newFiles = 0;
    let updatedFiles = 0;

    for (const [filePath, stat] of currentFiles) {
      const known = this.knownFiles.get(filePath);

      if (!known) {
        // New file since snapshot
        newFiles++;
        this.knownFiles.set(filePath, stat);
        
        // Emit event for new file
        setTimeout(() => this.emitSessionEvent(filePath, true), 0);
      } else if (stat.mtime > known.mtime || stat.size !== known.size) {
        // File updated since snapshot
        updatedFiles++;
        this.knownFiles.set(filePath, stat);
        
        // Emit event for updated file
        setTimeout(() => this.emitSessionEvent(filePath, false), 0);
      }
    }

    if (newFiles > 0 || updatedFiles > 0) {
      console.log(`🔄 Catch-up: ${newFiles} new, ${updatedFiles} updated files since last run`);
    }
  }

  /**
   * Get current watching status
   */
  get status(): { running: boolean; watchPath: string; fileCount: number } {
    return {
      running: this.isRunning,
      watchPath: PROJECTS_DIR,
      fileCount: this.knownFiles.size,
    };
  }

  /**
   * Get list of known session files
   */
  getKnownFiles(): string[] {
    return Array.from(this.knownFiles.keys());
  }
}

// Export singleton for convenience
export const defaultWatcher = new SessionWatcher();

// Export projects directory constant
export { PROJECTS_DIR };
