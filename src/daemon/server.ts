/**
 * Daemon Process Manager
 * Handles start/stop/status for the claude-learner daemon
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { SessionWatcher, PROJECTS_DIR, WatcherEvent } from './watcher.js';
import { sessionAnalyzer } from './analyzer.js';

// Constants
const PID_FILE = '/tmp/claude-learner.pid';
const LOG_FILE = '/tmp/claude-learner.log';

/**
 * Daemon status information
 */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  watchPath?: string;
  fileCount?: number;
  startedAt?: Date;
}

/**
 * Get the current daemon status
 */
export function getDaemonStatus(): DaemonStatus {
  const pid = readPidFile();
  
  if (!pid) {
    return { running: false };
  }

  // Check if process is actually running
  if (!isProcessRunning(pid)) {
    // Stale PID file, clean up
    removePidFile();
    return { running: false };
  }

  // Get process start time from /proc or ps
  const startedAt = getProcessStartTime(pid);
  const uptime = startedAt ? Date.now() - startedAt.getTime() : undefined;

  return {
    running: true,
    pid,
    uptime,
    watchPath: PROJECTS_DIR,
    startedAt,
  };
}

/**
 * Start the daemon in the background
 */
export async function startDaemon(foreground = false): Promise<DaemonStatus> {
  // Check if already running
  const status = getDaemonStatus();
  if (status.running) {
    console.log(`⚠️  Daemon already running (PID: ${status.pid})`);
    return status;
  }

  if (foreground) {
    // Run in foreground (for debugging)
    return runDaemonForeground();
  }

  // Spawn detached daemon process
  // Always use the compiled dist/index.js for the daemon subprocess
  const scriptPath = process.argv[1];
  const projectRoot = path.dirname(scriptPath.includes('dist') ? path.dirname(scriptPath) : scriptPath);
  const distIndex = path.join(projectRoot, 'dist', 'index.js');
  
  // Check if compiled version exists
  if (!fs.existsSync(distIndex)) {
    console.log('⚠️  Compiled dist/index.js not found. Run `npm run build` first.');
    console.log('   Or use --foreground to run in development mode.');
    return { running: false };
  }
  
  const child = spawn(process.execPath, [distIndex, 'daemon-run'], {
    detached: true,
    stdio: ['ignore', 
      fs.openSync(LOG_FILE, 'a'), 
      fs.openSync(LOG_FILE, 'a')
    ],
    env: { ...process.env, CLAUDE_LEARNER_DAEMON: '1' },
  });

  // Let the daemon run independently
  child.unref();

  // Wait a bit for the daemon to start and write PID file
  await sleep(500);

  return getDaemonStatus();
}

/**
 * Run daemon in foreground (blocking)
 */
async function runDaemonForeground(): Promise<DaemonStatus> {
  const watcher = new SessionWatcher();
  
  // Write PID file
  writePidFile(process.pid);

  // Setup graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n📨 Received ${signal}, shutting down gracefully...`);
    await watcher.stop();
    removePidFile();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle uncaught errors
  process.on('uncaughtException', async (err) => {
    console.error('❌ Uncaught exception:', err);
    await watcher.stop();
    removePidFile();
    process.exit(1);
  });

  // Start watcher
  console.log('🚀 Starting claude-learner daemon...');
  
  watcher.on('session.created', (event) => {
    console.log(`📗 New session: ${event.sessionId}`);
  });

  watcher.on('session.updated', (event) => {
    console.log(`📝 Updated: ${event.sessionId}`);
  });

  watcher.on('error', (err) => {
    console.error('❌ Watcher error:', err);
  });

  await watcher.start();

  console.log(`✅ Daemon running (PID: ${process.pid})`);
  console.log(`📁 Watching: ${PROJECTS_DIR}`);
  console.log(`📄 Log: ${LOG_FILE}`);
  console.log('Press Ctrl+C to stop\n');

  return {
    running: true,
    pid: process.pid,
    watchPath: PROJECTS_DIR,
    startedAt: new Date(),
  };
}

/**
 * Stop the running daemon
 */
export function stopDaemon(): boolean {
  const status = getDaemonStatus();
  
  if (!status.running || !status.pid) {
    console.log('ℹ️  Daemon is not running');
    return false;
  }

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(status.pid, 'SIGTERM');
    console.log(`🛑 Sent SIGTERM to daemon (PID: ${status.pid})`);

    // Wait for process to exit
    let attempts = 0;
    while (attempts < 20 && isProcessRunning(status.pid)) {
      sleepSync(100);
      attempts++;
    }

    // Force kill if still running
    if (isProcessRunning(status.pid)) {
      console.log('⚠️  Daemon not responding, sending SIGKILL...');
      process.kill(status.pid, 'SIGKILL');
    }

    // Clean up PID file
    removePidFile();

    console.log('✅ Daemon stopped');
    return true;
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      // Process doesn't exist, clean up stale PID
      removePidFile();
      console.log('ℹ️  Daemon was not running (stale PID file cleaned up)');
      return false;
    }
    throw err;
  }
}

/**
 * Restart the daemon
 */
export async function restartDaemon(): Promise<DaemonStatus> {
  stopDaemon();
  await sleep(500);
  return startDaemon();
}

/**
 * Entry point for daemon subprocess
 * Called when CLAUDE_LEARNER_DAEMON=1
 */
export async function runDaemonProcess(): Promise<void> {
  const watcher = new SessionWatcher();
  
  // Write PID file
  writePidFile(process.pid);

  // Setup graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down...`);
    await watcher.stop();
    removePidFile();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle errors
  process.on('uncaughtException', async (err) => {
    console.error(`[${new Date().toISOString()}] Uncaught exception:`, err);
    await watcher.stop();
    removePidFile();
    process.exit(1);
  });

  // Event handlers - analyze sessions on changes
  watcher.on('session.created', async (event: WatcherEvent) => {
    console.log(`[${new Date().toISOString()}] New: ${event.sessionId}`);
    const patterns = await sessionAnalyzer.analyzeSession(
      event.sessionPath, 
      event.sessionId, 
      event.projectPath
    );
    if (patterns.length > 0) {
      console.log(`[${new Date().toISOString()}] Found ${patterns.length} patterns`);
    }
  });

  watcher.on('session.updated', async (event: WatcherEvent) => {
    console.log(`[${new Date().toISOString()}] Updated: ${event.sessionId}`);
    const patterns = await sessionAnalyzer.analyzeSession(
      event.sessionPath, 
      event.sessionId, 
      event.projectPath
    );
    if (patterns.length > 0) {
      console.log(`[${new Date().toISOString()}] Found ${patterns.length} patterns`);
    }
  });

  watcher.on('error', (err: Error) => {
    console.error(`[${new Date().toISOString()}] Error:`, err);
  });

  // Start
  console.log(`[${new Date().toISOString()}] claude-learner daemon starting (PID: ${process.pid})`);
  await watcher.start();
  console.log(`[${new Date().toISOString()}] Daemon running, watching ${PROJECTS_DIR}`);
}

// ============ Utility Functions ============

function readPidFile(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

function writePidFile(pid: number): void {
  fs.writeFileSync(PID_FILE, String(pid));
}

function removePidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore remove errors
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessStartTime(pid: number): Date | undefined {
  try {
    // Use execFileSync to avoid shell interpolation (security best practice)
    const { execFileSync } = require('child_process');
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (output.trim()) {
      return new Date(output.trim());
    }
  } catch {
    // Fallback: just return undefined
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait
  }
}

// Export constants
export { PID_FILE, LOG_FILE };
