#!/usr/bin/env node
/**
 * MCP Server for claude-learner v2
 * 
 * Exposes learning/rules tools to Claude Code via MCP protocol
 * Transport: stdio (for Claude Code integration)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  // Schemas
  GetRulesInputSchema,
  CheckRuleInputSchema,
  LogCorrectionInputSchema,
  GetPendingRulesInputSchema,
  ApproveRuleInputSchema,
  RejectRuleInputSchema,
  RecordComplianceInputSchema,
  // Handlers
  handleGetRules,
  handleCheckRule,
  handleLogCorrection,
  handleGetPendingRules,
  handleApproveRule,
  handleRejectRule,
  handleRecordCompliance,
} from './tools.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'get_rules',
    description: 'Get active rules for current context. Call this at session start to load relevant rules that Claude should follow.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Filter by project path',
        },
        file: {
          type: 'string',
          description: 'Filter by file path',
        },
        scope: {
          type: 'string',
          enum: ['global', 'project', 'file'],
          description: 'Filter by scope',
        },
      },
    },
  },
  {
    name: 'check_rule',
    description: 'Check if an action would violate a learned rule. Call this before taking potentially rule-violating actions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          description: 'The action about to be taken (e.g., "Using any type")',
        },
        context: {
          type: 'string',
          description: 'File/project context',
        },
      },
      required: ['action', 'context'],
    },
  },
  {
    name: 'log_correction',
    description: 'Log when user corrects Claude. This helps the system learn new rules from corrections.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userMessage: {
          type: 'string',
          description: 'The user correction message',
        },
        assistantContext: {
          type: 'string',
          description: 'What Claude was doing when corrected',
        },
        project: {
          type: 'string',
          description: 'Project path',
        },
        file: {
          type: 'string',
          description: 'File path if applicable',
        },
      },
      required: ['userMessage', 'assistantContext', 'project'],
    },
  },
  {
    name: 'get_pending_rules',
    description: 'Get rules awaiting user approval. These are rules proposed from detected patterns.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'approve_rule',
    description: 'Approve a pending rule, making it active.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: {
          type: 'string',
          description: 'ID of the rule to approve',
        },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'reject_rule',
    description: 'Reject a pending rule.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: {
          type: 'string',
          description: 'ID of the rule to reject',
        },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'record_compliance',
    description: 'Record whether a rule was followed. Call this to help track rule effectiveness.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: {
          type: 'string',
          description: 'ID of the rule',
        },
        followed: {
          type: 'boolean',
          description: 'Whether the rule was followed',
        },
      },
      required: ['ruleId', 'followed'],
    },
  },
];

// ============================================================================
// Server Implementation
// ============================================================================

class ClaudeLearnerServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'claude-learner',
        version: '2.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_rules': {
            const parsed = GetRulesInputSchema.parse(args);
            const result = await handleGetRules(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'check_rule': {
            const parsed = CheckRuleInputSchema.parse(args);
            const result = await handleCheckRule(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'log_correction': {
            const parsed = LogCorrectionInputSchema.parse(args);
            const result = await handleLogCorrection(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_pending_rules': {
            const parsed = GetPendingRulesInputSchema.parse(args);
            const result = await handleGetPendingRules(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'approve_rule': {
            const parsed = ApproveRuleInputSchema.parse(args);
            const result = await handleApproveRule(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'reject_rule': {
            const parsed = RejectRuleInputSchema.parse(args);
            const result = await handleRejectRule(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'record_compliance': {
            const parsed = RecordComplianceInputSchema.parse(args);
            const result = await handleRecordCompliance(parsed);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        
        // Handle Zod validation errors
        if (error instanceof Error && error.name === 'ZodError') {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${error.message}`
          );
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[claude-learner MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[claude-learner] MCP server running on stdio');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function startMcpServer(): Promise<void> {
  const server = new ClaudeLearnerServer();
  await server.run();
}

// Auto-start if run directly
const isMainModule = import.meta.url.endsWith('/mcp/server.ts') || 
                     import.meta.url.endsWith('/mcp/server.js');
if (isMainModule && process.argv[1]?.includes('mcp')) {
  startMcpServer().catch((error) => {
    console.error('[claude-learner] Fatal error:', error);
    process.exit(1);
  });
}
