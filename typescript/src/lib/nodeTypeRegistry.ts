/**
 * Node Type Registry - Single source of truth for workflow node types (CLI)
 *
 * Contains all valid node type keys, labels, descriptions, and categories.
 * No icons or colors — those are frontend-only concerns.
 *
 * Frontend counterpart: prompd.app/frontend/src/modules/services/nodeTypeRegistry.ts
 * Future: Consolidate both into a shared @prompd/shared package.
 *
 * When adding a new node type:
 *   1. Add it to WorkflowNodeType union in workflowTypes.ts
 *   2. Add an entry to NODE_TYPE_REGISTRY below
 *   3. Add execution logic in workflowExecutor.ts
 *   4. Mirror in frontend nodeTypeRegistry.ts + node components
 */

import type { WorkflowNodeType } from './workflowTypes.js'

// ============================================================================
// Types
// ============================================================================

export interface NodeTypeEntry {
  type: WorkflowNodeType
  label: string
  description: string
}

export interface NodeTypeCategory {
  key: string
  label: string
  types: WorkflowNodeType[]
}

// ============================================================================
// Registry
// ============================================================================

export const NODE_TYPE_REGISTRY: Record<WorkflowNodeType, NodeTypeEntry> = {
  // Entry & Exit
  'trigger': {
    type: 'trigger', label: 'Trigger', description: 'Workflow entry point',
  },
  'output': {
    type: 'output', label: 'Output', description: 'Workflow final output',
  },

  // AI & Prompts
  'prompt': {
    type: 'prompt', label: 'Prompt', description: 'Execute a .prmd file',
  },
  'provider': {
    type: 'provider', label: 'Provider', description: 'LLM provider & model config',
  },
  'agent': {
    type: 'agent', label: 'AI Agent', description: 'Autonomous agent with tools',
  },
  'chat-agent': {
    type: 'chat-agent', label: 'Chat Agent', description: 'Input + Guard + Agent + Tools',
  },
  'claude-code': {
    type: 'claude-code', label: 'Claude Code', description: 'Claude Code agent (local/SSH)',
  },
  'guardrail': {
    type: 'guardrail', label: 'Guardrail', description: 'Validate input with pass/reject',
  },

  // Tools & Execution
  'tool': {
    type: 'tool', label: 'Tool', description: 'Unified tool execution',
  },
  'command': {
    type: 'command', label: 'Command', description: 'Execute shell commands',
  },
  'web-search': {
    type: 'web-search', label: 'Web Search', description: 'Search the web',
  },
  'code': {
    type: 'code', label: 'Code', description: 'Run TS/Python/C# snippets',
  },
  'api': {
    type: 'api', label: 'HTTP Request', description: 'Make REST API calls',
  },
  'mcp-tool': {
    type: 'mcp-tool', label: 'MCP Tool', description: 'External MCP server tool',
  },
  'database-query': {
    type: 'database-query', label: 'DB Query', description: 'Query a database connection',
  },
  // --- Add new tool/execution node types here ---

  // Tool Routing
  'tool-call-parser': {
    type: 'tool-call-parser', label: 'Tool Parser', description: 'Parse LLM tool call output',
  },
  'tool-call-router': {
    type: 'tool-call-router', label: 'Tool Router', description: 'Route tool calls to handlers',
  },

  // Control Flow
  'condition': {
    type: 'condition', label: 'Condition', description: 'Branch based on expression',
  },
  'loop': {
    type: 'loop', label: 'Loop', description: 'Iterate over items or count',
  },
  'parallel': {
    type: 'parallel', label: 'Parallel', description: 'Execute branches concurrently',
  },
  'merge': {
    type: 'merge', label: 'Merge', description: 'Combine parallel results',
  },

  // Data
  'transformer': {
    type: 'transformer', label: 'Transform', description: 'Transform data with template',
  },
  'memory': {
    type: 'memory', label: 'Memory', description: 'KV store, conversation, or cache',
  },

  // Interaction & Debug
  'user-input': {
    type: 'user-input', label: 'User Input', description: 'Pause for user input',
  },
  'callback': {
    type: 'callback', label: 'Checkpoint', description: 'Log, pause, approve, or notify',
  },
  'checkpoint': {
    type: 'checkpoint', label: 'Checkpoint', description: 'Log, pause, approve, or notify',
  },
  'error-handler': {
    type: 'error-handler', label: 'Error Handler', description: 'Configure error handling',
  },

  // Composition
  'workflow': {
    type: 'workflow', label: 'Sub-Workflow', description: 'Invoke another .pdflow',
  },
}

// ============================================================================
// Categories
// ============================================================================

export const NODE_TYPE_CATEGORIES: NodeTypeCategory[] = [
  {
    key: 'entry-exit',
    label: 'Entry & Exit',
    types: ['trigger', 'output'],
  },
  {
    key: 'ai-prompts',
    label: 'AI & Prompts',
    types: ['prompt', 'provider', 'agent', 'chat-agent', 'claude-code', 'guardrail'],
  },
  {
    key: 'tools-execution',
    label: 'Tools & Execution',
    types: ['tool', 'command', 'web-search', 'code', 'api', 'mcp-tool', 'database-query'],
  },
  {
    key: 'tool-routing',
    label: 'Tool Routing',
    types: ['tool-call-parser', 'tool-call-router'],
  },
  {
    key: 'control-flow',
    label: 'Control Flow',
    types: ['condition', 'loop', 'parallel', 'merge'],
  },
  {
    key: 'data',
    label: 'Data',
    types: ['transformer', 'memory'],
  },
  {
    key: 'interaction',
    label: 'Interaction',
    types: ['user-input', 'callback', 'error-handler'],
  },
  {
    key: 'composition',
    label: 'Composition',
    types: ['workflow'],
  },
]

// ============================================================================
// Derived helpers
// ============================================================================

/** All valid node type keys (for parser validation) */
export const ALL_NODE_TYPES: WorkflowNodeType[] = Object.keys(NODE_TYPE_REGISTRY) as WorkflowNodeType[]

/** Get a node type entry, returns undefined for unknown types */
export function getNodeTypeEntry(type: WorkflowNodeType): NodeTypeEntry | undefined {
  return NODE_TYPE_REGISTRY[type]
}
