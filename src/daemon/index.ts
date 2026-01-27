/**
 * Daemon module exports
 */

export { SessionWatcher, PROJECTS_DIR, defaultWatcher } from './watcher.js';
export type { WatcherEvent, WatcherSnapshot, WatcherOptions } from './watcher.js';

export { 
  startDaemon, 
  stopDaemon, 
  restartDaemon, 
  getDaemonStatus,
  runDaemonProcess,
  PID_FILE,
  LOG_FILE 
} from './server.js';
export type { DaemonStatus } from './server.js';

export { SessionAnalyzer, sessionAnalyzer } from './analyzer.js';
