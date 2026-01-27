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
  .description('Analyze Claude Code sessions and generate CLAUDE.md improvements')
  .version('1.1.0');

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

program.parse();
