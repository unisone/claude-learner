#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { findSessions } from './utils.js';
import { analyzeSessions, formatAnalysisResult } from './analyzer.js';
import { generateImprovements, formatImprovementResult } from './improver.js';
import { exportLearnings, formatExportResult } from './exporter.js';
const program = new Command();

const banner = `
${chalk.cyan.bold('╔═══════════════════════════════════════════════════════════╗')}
${chalk.cyan.bold('║')}  ${chalk.yellow.bold('🧠 Claude Learner')}                                        ${chalk.cyan.bold('║')}
${chalk.cyan.bold('║')}  ${chalk.dim('Every mistake becomes a rule. Automatically.')}              ${chalk.cyan.bold('║')}
${chalk.cyan.bold('╚═══════════════════════════════════════════════════════════╝')}
`;

const supportMessage = `
${chalk.dim('─'.repeat(50))}
${chalk.cyan('☕ If this tool helped you, consider buying me a coffee!')}
${chalk.dim('   https://buymeacoffee.com/unisone')}
${chalk.dim('   https://github.com/sponsors/unisone')}
${chalk.dim('─'.repeat(50))}
`;

program
  .name('claude-learner')
  .description('🧠 Your AI that trains itself. MCP-native self-improving agent for Claude Code.')
  .version('2.2.0');

// ============================================
// INIT - Quick setup
// ============================================

program
  .command('init')
  .description('Set up claude-learner and register with Claude Code')
  .option('--skip-mcp', 'Skip MCP registration')
  .action(async (options) => {
    console.log(banner);
    console.log(chalk.bold.cyan('🚀 Setting up claude-learner...\n'));
    
    const spinner = ora('Initializing database...').start();
    
    try {
      // 1. Initialize database
      const { getDB, closeDB } = await import('./storage/db.js');
      const db = getDB();
      const stats = db.getStats();
      closeDB();
      
      spinner.succeed(`Database ready (${stats.rules.total} rules, ${stats.patterns.total} patterns)`);
      
      // 2. Check if Claude Code is installed
      if (!options.skipMcp) {
        spinner.start('Checking Claude Code...');
        
        const { execSync } = await import('child_process');
        try {
          execSync('claude --version', { stdio: 'pipe' });
          spinner.succeed('Claude Code detected');
          
          // 3. Register MCP server
          spinner.start('Registering MCP server...');
          try {
            // Find our script path
            const scriptPath = process.argv[1];
            const mcpCommand = `node ${scriptPath} mcp-serve`;
            
            execSync(`claude mcp add claude-learner -- ${mcpCommand}`, { stdio: 'pipe' });
            spinner.succeed('MCP server registered with Claude Code');
          } catch {
            spinner.warn('Could not register MCP server (may already be registered)');
          }
        } catch {
          spinner.warn('Claude Code not found (install with: npm install -g @anthropic-ai/claude-code)');
        }
      }
      
      // 4. Start daemon
      spinner.start('Starting daemon...');
      const { startDaemon } = await import('./daemon/server.js');
      await startDaemon(false);
      spinner.succeed('Daemon started');
      
      // Done!
      console.log(chalk.bold.green('\n✅ Setup complete!\n'));
      console.log(`${chalk.cyan('What happens now:')}`);
      console.log(`  • Daemon watches your Claude Code sessions`);
      console.log(`  • Patterns are detected automatically`);
      console.log(`  • Rules are proposed for your approval`);
      console.log(`  • Claude follows approved rules\n`);
      console.log(`${chalk.cyan('Commands:')}`);
      console.log(`  ${chalk.dim('claude-learner rules --pending')}   View proposed rules`);
      console.log(`  ${chalk.dim('claude-learner approve <id>')}      Approve a rule`);
      console.log(`  ${chalk.dim('claude-learner daemon-status')}     Check daemon status`);
      console.log(`  ${chalk.dim('claude-learner stop')}              Stop the daemon\n`);
      
    } catch (error) {
      spinner.fail('Setup failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze Claude Code session history for patterns')
  .option('-n, --sessions <number>', 'Number of recent sessions to analyze', '10')
  .option('-a, --all', 'Analyze all sessions')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options) => {
    console.log(banner);
    
    const spinner = ora('Finding Claude Code sessions...').start();
    
    try {
      const limit = options.all ? undefined : parseInt(options.sessions);
      const sessions = await findSessions(limit);
      
      if (sessions.length === 0) {
        spinner.fail('No Claude Code sessions found');
        console.log(chalk.dim('\nMake sure you have used Claude Code and sessions exist in ~/.claude/projects/'));
        process.exit(1);
      }
      
      spinner.text = `Analyzing ${sessions.length} sessions...`;
      const result = analyzeSessions(sessions);
      
      spinner.succeed(`Analyzed ${sessions.length} sessions`);
      
      console.log(formatAnalysisResult(result));
      
      if (options.verbose) {
        console.log(chalk.dim('\nSession paths analyzed:'));
        for (const session of sessions.slice(0, 5)) {
          console.log(chalk.dim(`  • ${session.path}`));
        }
        if (sessions.length > 5) {
          console.log(chalk.dim(`  ... and ${sessions.length - 5} more`));
        }
      }
      
      console.log(chalk.cyan('\n💡 Run `claude-learner improve` to generate CLAUDE.md suggestions\n'));
      
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('improve')
  .description('Generate CLAUDE.md improvements based on analysis')
  .option('-n, --sessions <number>', 'Number of recent sessions to analyze', '10')
  .option('-a, --all', 'Analyze all sessions')
  .option('-k, --api-key <key>', 'OpenAI API key for enhanced analysis')
  .action(async (options) => {
    console.log(banner);
    
    const spinner = ora('Analyzing sessions...').start();
    
    try {
      const limit = options.all ? undefined : parseInt(options.sessions);
      const sessions = await findSessions(limit);
      
      if (sessions.length === 0) {
        spinner.fail('No Claude Code sessions found');
        process.exit(1);
      }
      
      const analysis = analyzeSessions(sessions);
      
      spinner.text = 'Generating improvements...';
      
      const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        spinner.warn('No OpenAI API key - using basic analysis');
        console.log(chalk.dim('Set OPENAI_API_KEY or use --api-key for enhanced AI analysis\n'));
      }
      
      const improvements = await generateImprovements(analysis, apiKey);
      
      spinner.succeed('Improvements generated');
      
      console.log(formatImprovementResult(improvements));
      console.log(supportMessage);
      console.log(chalk.cyan('\n💡 Run `claude-learner export` to save to .learnings/ directory\n'));
      
    } catch (error) {
      spinner.fail('Improvement generation failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export learnings to .learnings/ directory')
  .option('-n, --sessions <number>', 'Number of recent sessions to analyze', '10')
  .option('-a, --all', 'Analyze all sessions')
  .option('-o, --output <dir>', 'Output directory', '.learnings')
  .option('-f, --format <format>', 'Output format (markdown|json)', 'markdown')
  .option('--include-raw', 'Include raw pattern data')
  .option('-k, --api-key <key>', 'OpenAI API key for enhanced analysis')
  .action(async (options) => {
    console.log(banner);
    
    const spinner = ora('Preparing export...').start();
    
    try {
      const limit = options.all ? undefined : parseInt(options.sessions);
      const sessions = await findSessions(limit);
      
      if (sessions.length === 0) {
        spinner.fail('No Claude Code sessions found');
        process.exit(1);
      }
      
      spinner.text = 'Analyzing sessions...';
      const analysis = analyzeSessions(sessions);
      
      spinner.text = 'Generating improvements...';
      const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
      const improvements = await generateImprovements(analysis, apiKey);
      
      spinner.text = 'Exporting files...';
      const result = exportLearnings(analysis, improvements, {
        outputDir: options.output,
        format: options.format,
        includeRaw: options.includeRaw
      });
      
      spinner.succeed('Export complete');
      
      console.log(formatExportResult(result));
      console.log(supportMessage);
      
    } catch (error) {
      spinner.fail('Export failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show statistics about your Claude Code usage')
  .option('-n, --sessions <number>', 'Number of recent sessions to analyze', '20')
  .option('-a, --all', 'Analyze all sessions')
  .action(async (options) => {
    console.log(banner);
    
    const spinner = ora('Gathering statistics...').start();
    
    try {
      const limit = options.all ? undefined : parseInt(options.sessions);
      const sessions = await findSessions(limit);
      
      if (sessions.length === 0) {
        spinner.fail('No Claude Code sessions found');
        process.exit(1);
      }
      
      // Calculate stats
      let totalMessages = 0;
      let userMessages = 0;
      let assistantMessages = 0;
      let toolCalls = 0;
      const projectCounts = new Map<string, number>();
      
      for (const session of sessions) {
        totalMessages += session.messages.length;
        
        for (const msg of session.messages) {
          if (msg.message?.role === 'user') userMessages++;
          if (msg.message?.role === 'assistant') assistantMessages++;
          if (msg.type === 'tool_use' || msg.type === 'tool_result') toolCalls++;
        }
        
        // Track projects
        const projectName = session.projectPath.split('/').pop() || 'unknown';
        projectCounts.set(projectName, (projectCounts.get(projectName) || 0) + 1);
      }
      
      spinner.succeed('Statistics gathered');
      
      // Format output
      console.log(chalk.bold.cyan('\n📈 Claude Code Statistics\n'));
      console.log(chalk.dim('─'.repeat(50)));
      console.log('');
      console.log(`${chalk.bold('Sessions:')} ${sessions.length}`);
      console.log(`${chalk.bold('Total messages:')} ${totalMessages.toLocaleString()}`);
      console.log(`${chalk.bold('  └─ User messages:')} ${userMessages.toLocaleString()}`);
      console.log(`${chalk.bold('  └─ Assistant messages:')} ${assistantMessages.toLocaleString()}`);
      console.log(`${chalk.bold('  └─ Tool calls:')} ${toolCalls.toLocaleString()}`);
      console.log('');
      
      // Show date range
      if (sessions.length > 0) {
        const newest = sessions[0].timestamp;
        const oldest = sessions[sessions.length - 1].timestamp;
        console.log(`${chalk.bold('Date range:')} ${oldest.toLocaleDateString()} → ${newest.toLocaleDateString()}`);
      }
      
      // Top projects
      const topProjects = [...projectCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      if (topProjects.length > 0) {
        console.log('');
        console.log(chalk.bold('Top projects:'));
        for (const [project, count] of topProjects) {
          console.log(`  ${chalk.cyan('•')} ${project}: ${count} sessions`);
        }
      }
      
      console.log('');
      console.log(chalk.dim('─'.repeat(50)));
      console.log(chalk.cyan('\n💡 Run `claude-learner analyze` to find improvement opportunities\n'));
      
    } catch (error) {
      spinner.fail('Failed to gather statistics');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// ============================================
// V2 COMMANDS - MCP-Native Self-Improving Agent
// ============================================

program
  .command('start')
  .description('Start the learning daemon and MCP server')
  .option('-f, --foreground', 'Run in foreground (don\'t daemonize)')
  .action(async (options) => {
    console.log(banner);
    const { startDaemon } = await import('./daemon/server.js');
    await startDaemon(options.foreground);
  });

program
  .command('stop')
  .description('Stop the learning daemon')
  .action(async () => {
    const { stopDaemon } = await import('./daemon/server.js');
    await stopDaemon();
  });

program
  .command('watch')
  .description('Watch live activity from the daemon (tail logs)')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(async (options) => {
    console.log(banner);
    console.log(chalk.bold.cyan('👁️  Live Activity (Ctrl+C to stop)\n'));
    console.log(chalk.dim('─'.repeat(50)));
    
    const { LOG_FILE, getDaemonStatus } = await import('./daemon/server.js');
    const { spawn } = await import('child_process');
    const fs = await import('fs');
    
    const status = getDaemonStatus();
    if (!status.running) {
      console.log(chalk.yellow('\n⚠️  Daemon not running. Start with: claude-learner start\n'));
      process.exit(1);
    }
    
    // Check if log file exists
    if (!fs.existsSync(LOG_FILE)) {
      console.log(chalk.dim('\nNo log file yet. Waiting for activity...\n'));
    }
    
    // Tail the log file
    const tail = spawn('tail', ['-f', '-n', options.lines, LOG_FILE], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    
    process.on('SIGINT', () => {
      tail.kill();
      console.log(chalk.dim('\n\nStopped watching.'));
      process.exit(0);
    });
  });

program
  .command('daemon-status')
  .alias('status')
  .description('Show daemon and MCP server status')
  .action(async () => {
    console.log(banner);
    const { getDaemonStatus, LOG_FILE, PID_FILE } = await import('./daemon/server.js');
    const status = getDaemonStatus();
    
    console.log(chalk.bold.cyan('\n🔧 Daemon Status\n'));
    console.log(chalk.dim('─'.repeat(50)));
    
    if (status.running) {
      console.log(`${chalk.green('●')} Daemon: ${chalk.green('Running')} (PID: ${status.pid})`);
      console.log(`${chalk.dim('  └─')} Watch path: ${status.watchPath || '~/.claude/projects/'}`);
      if (status.uptime) {
        const uptimeSec = Math.floor(status.uptime / 1000);
        const uptimeMin = Math.floor(uptimeSec / 60);
        const uptimeHr = Math.floor(uptimeMin / 60);
        const uptimeStr = uptimeHr > 0 
          ? `${uptimeHr}h ${uptimeMin % 60}m` 
          : uptimeMin > 0 
            ? `${uptimeMin}m ${uptimeSec % 60}s`
            : `${uptimeSec}s`;
        console.log(`${chalk.dim('  └─')} Uptime: ${uptimeStr}`);
      }
      if (status.startedAt) {
        console.log(`${chalk.dim('  └─')} Started: ${status.startedAt.toLocaleString()}`);
      }
      console.log(`${chalk.dim('  └─')} PID file: ${PID_FILE}`);
      console.log(`${chalk.dim('  └─')} Log file: ${LOG_FILE}`);
      
      // Show rule stats
      const { getDB } = await import('./storage/db.js');
      const db = getDB();
      const stats = db.getStats();
      
      console.log('');
      console.log(`${chalk.bold('📊 Stats')}`);
      console.log(`${chalk.dim('  └─')} Rules: ${stats.rules.active || 0} active, ${stats.rules.proposed || 0} pending`);
      console.log(`${chalk.dim('  └─')} Patterns: ${stats.patterns.total} detected`);
      console.log(`${chalk.dim('  └─')} Sessions: ${stats.sessions.total} tracked`);
    } else {
      console.log(`${chalk.red('●')} Daemon: ${chalk.red('Not running')}`);
      console.log(chalk.dim('\nRun `claude-learner start` to begin learning'));
    }
    console.log('');
  });

program
  .command('rules')
  .description('List and manage rules')
  .option('-a, --all', 'Show all rules including rejected/pruned')
  .option('--pending', 'Show only pending rules')
  .option('--effectiveness', 'Show effectiveness report')
  .action(async (options) => {
    console.log(banner);
    const { getDB } = await import('./storage/db.js');
    const { getComplianceRate } = await import('./storage/types.js');
    
    const db = getDB();
    
    if (options.effectiveness) {
      const rules = db.getRules({ state: 'active' });
      
      console.log(chalk.bold.cyan('\n📊 Rule Effectiveness Report\n'));
      console.log(chalk.dim('─'.repeat(50)));
      
      const high = rules.filter(r => getComplianceRate(r) >= 0.8);
      const medium = rules.filter(r => getComplianceRate(r) >= 0.5 && getComplianceRate(r) < 0.8);
      const low = rules.filter(r => getComplianceRate(r) < 0.5);
      
      if (high.length > 0) {
        console.log(chalk.green('\n✅ HIGH (>80% compliance):'));
        for (const r of high) {
          console.log(`   • "${r.text.slice(0, 50)}..." — ${Math.round(getComplianceRate(r) * 100)}%`);
        }
      }
      
      if (medium.length > 0) {
        console.log(chalk.yellow('\n⚠️  MEDIUM (50-80% compliance):'));
        for (const r of medium) {
          console.log(`   • "${r.text.slice(0, 50)}..." — ${Math.round(getComplianceRate(r) * 100)}%`);
        }
      }
      
      if (low.length > 0) {
        console.log(chalk.red('\n❌ LOW (<50% compliance):'));
        for (const r of low) {
          console.log(`   • "${r.text.slice(0, 50)}..." — ${Math.round(getComplianceRate(r) * 100)}%`);
        }
      }
      
      if (rules.length === 0) {
        console.log(chalk.dim('\nNo active rules yet. Run `claude-learner start` to begin learning.'));
      }
    } else if (options.pending) {
      const pending = db.getProposedRules();
      
      console.log(chalk.bold.cyan('\n📬 Pending Rules\n'));
      console.log(chalk.dim('─'.repeat(50)));
      
      if (pending.length === 0) {
        console.log(chalk.dim('\nNo pending rules. Keep using Claude Code!'));
      } else {
        for (let i = 0; i < pending.length; i++) {
          const r = pending[i];
          console.log(`\n${i + 1}. "${chalk.white(r.text)}"`);
          console.log(chalk.dim(`   Scope: ${r.scope}${r.scopeTarget ? ` (${r.scopeTarget})` : ''}`));
          console.log(chalk.dim(`   ID: ${r.id}`));
        }
        console.log(chalk.cyan('\n💡 Use `claude-learner approve <id>` or `claude-learner reject <id>`'));
      }
    } else {
      const states = options.all ? undefined : ['active', 'proposed'];
      const rules = states 
        ? db.getRules({ states: states as any })
        : db.getRules();
      
      console.log(chalk.bold.cyan('\n📋 Rules\n'));
      console.log(chalk.dim('─'.repeat(50)));
      
      if (rules.length === 0) {
        console.log(chalk.dim('\nNo rules yet. Run `claude-learner start` to begin learning.'));
      } else {
        for (const r of rules) {
          const stateIcon = r.state === 'active' ? chalk.green('●') :
                           r.state === 'proposed' ? chalk.yellow('○') :
                           r.state === 'pruned' ? chalk.red('✗') : chalk.dim('○');
          console.log(`${stateIcon} [${r.scope}] ${r.text.slice(0, 60)}${r.text.length > 60 ? '...' : ''}`);
        }
      }
    }
    console.log('');
  });

program
  .command('approve <id>')
  .description('Approve a pending rule')
  .action(async (id) => {
    const { getDB } = await import('./storage/db.js');
    const db = getDB();
    
    const rule = db.approveRule(id);
    if (rule) {
      console.log(chalk.green(`✅ Rule approved: "${rule.text}"`));
    } else {
      console.log(chalk.red(`❌ Rule not found or not pending: ${id}`));
    }
  });

program
  .command('reject <id>')
  .description('Reject a pending rule')
  .action(async (id) => {
    const { getDB } = await import('./storage/db.js');
    const db = getDB();
    
    const rule = db.rejectRule(id);
    if (rule) {
      console.log(chalk.yellow(`🚫 Rule rejected: "${rule.text}"`));
    } else {
      console.log(chalk.red(`❌ Rule not found or not pending: ${id}`));
    }
  });

program
  .command('sync')
  .description('Sync active rules into CLAUDE.md with managed comment markers')
  .option('-g, --global', 'Write global rules to ~/.claude/CLAUDE.md')
  .option('-p, --project <path>', 'Project path for scoped rules')
  .option('-t, --target <file>', 'Custom target CLAUDE.md path')
  .option('--dry-run', 'Show what would be written without modifying files')
  .action(async (options) => {
    const { syncRules, formatSyncResult } = await import('./sync.js');
    const result = syncRules({
      global: options.global,
      project: options.project,
      target: options.target,
      dryRun: options.dryRun,
    });
    console.log(formatSyncResult(result));
  });

program
  .command('mcp-serve')
  .description('Start MCP server (for Claude Code integration)')
  .action(async () => {
    const { startMcpServer } = await import('./mcp/server.js');
    await startMcpServer();
  });

program
  .command('support')
  .description('Show ways to support this project')
  .action(() => {
    console.log(banner);
    console.log(`
${chalk.bold.yellow('💛 Support Claude Learner')}

This tool is ${chalk.green('100% free')} and open source.
If it saved you time, consider supporting the project:

${chalk.cyan('☕ Buy Me a Coffee')}
   ${chalk.underline('https://buymeacoffee.com/unisone')}

${chalk.magenta('💜 GitHub Sponsors')}
   ${chalk.underline('https://github.com/sponsors/unisone')}

${chalk.yellow('🧡 Ko-fi')}
   ${chalk.underline('https://ko-fi.com/unisone')}

${chalk.bold('⭐ Star the repo')}
   ${chalk.underline('https://github.com/unisone/claude-learner')}

${chalk.dim('Every bit helps keep the project maintained and improving!')}
`);
  });

// Internal command for daemon subprocess
program
  .command('daemon-run', { hidden: true })
  .description('Internal: Run daemon process')
  .action(async () => {
    const { runDaemonProcess } = await import('./daemon/server.js');
    await runDaemonProcess();
  });

program.parse();
