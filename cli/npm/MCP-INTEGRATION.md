# Prompd CLI - Model Context Protocol (MCP) Integration

Complete MCP integration allowing .prompd files and .prompdflow workflows to be exposed as MCP tools for Claude Desktop and other MCP clients.

## Overview

The Prompd CLI now acts as an **MCP server** that exposes:
- **Individual .prompd prompts** as callable tools
- **Complete .prompdflow workflows** from prompd-IDE as single tools
- **Template mode** - Returns rendered prompts for client execution
- **Execution mode** - Full LLM integration with responses

## Quick Start

### 1. Add Individual Prompts
```bash
# Add a single prompt as MCP tool
prompd mcp add prompt research-assistant examples/advanced/research-assistant.prompd

# List registered tools
prompd mcp list
```

### 2. Add Workflows (from prompd-IDE)
```bash
# Add workflow with automatic discovery
prompd mcp add workflow user-signup

# Add workflow with explicit path
prompd mcp add workflow onboarding workflows/user-onboarding.prompdflow
```

### 3. Start MCP Server
```bash
# Template mode (default) - Claude executes rendered prompts
prompd mcp start

# Execution mode - Server executes prompts with LLM
prompd mcp start --execute --provider openai --model gpt-4

# Start with directory scanning
prompd mcp start --directory ./prompts
```

### 4. Claude Desktop Integration
```bash
# Generate Claude Desktop configuration
prompd mcp config

# Output example:
{
  "mcpServers": {
    "prompd": {
      "command": "prompd",
      "args": ["mcp", "start"],
      "env": {}
    }
  }
}
```

## Command Reference

### Core Commands

#### `prompd mcp start [options]`
Start MCP server to expose tools to clients.

**Options:**
- `-d, --directory <dir>` - Auto-register all .prompd/.prompdflow files from directory
- `-t, --tool <name:file>` - Register specific tools (format: name:file.prompd)
- `--execute` - Enable LLM execution mode (default: template mode)
- `--provider <provider>` - LLM provider (openai, anthropic, ollama)
- `--model <model>` - Model to use for execution
- `--allowed-tools <tools>` - Comma-separated whitelist of allowed tools
- `--max-request-size <bytes>` - Maximum request size (default: 10000)

**Examples:**
```bash
# Basic template mode
prompd mcp start

# Full execution mode
prompd mcp start --execute --provider openai --model gpt-4

# Auto-register from directory
prompd mcp start --directory ./my-prompts

# Security-enabled server
prompd mcp start --allowed-tools research,coder --max-request-size 5000
```

#### `prompd mcp add <type> <name> [file]`
Add prompts or workflows to MCP configuration.

**Arguments:**
- `type` - "prompt" or "workflow"
- `name` - Tool name for MCP
- `file` - Path to .prompd/.prompdflow file (optional for workflows)

**Workflow Auto-Discovery:**
When adding workflows without specifying a file, searches:
- `./workflows/{name}.prompdflow`
- `./{name}.prompdflow` 
- `./flows/{name}.prompdflow`

**Examples:**
```bash
# Add prompt
prompd mcp add prompt code-reviewer prompts/code-review.prompd

# Add workflow with auto-discovery
prompd mcp add workflow user-signup

# Add workflow with explicit path
prompd mcp add workflow complex-flow ./workflows/multi-step.prompdflow
```

#### `prompd mcp list [options]`
List all registered MCP tools.

#### `prompd mcp remove <name>`
Remove a tool from MCP configuration.

#### `prompd mcp config [options]`
Generate Claude Desktop MCP server configuration.

**Options:**
- `--output <file>` - Write to file instead of console
- `--server-name <name>` - MCP server name (default: "prompd")

## Workflow Integration

### .prompdflow Support
Full integration with prompd-IDE's visual workflow system:

- **Visual Workflows** → **Single MCP Tools**
- **Complex Node Graphs** → **Simple Parameter Interface**  
- **Multi-step Execution** → **Single Result**

### Supported Workflow Features
- ✅ **Parameter Nodes** - Exposed as MCP tool parameters
- ✅ **Prompt Nodes** - Execute individual prompts
- ✅ **Output Nodes** - Format final responses
- ✅ **Sequential Execution** - Basic node-by-node execution
- 🔄 **Conditional Logic** - Planned (condition nodes)
- 🔄 **Parallel Execution** - Planned (parallel node execution)
- 🔄 **Loop Nodes** - Planned (iteration support)

### Workflow Parameter Discovery
Parameters are automatically extracted from:
1. **Workflow Metadata** - `metadata.parameters[]` in .prompdflow
2. **Parameter Nodes** - Node type "parameter" in workflow graph
3. **Input Ports** - Required inputs from connected nodes

## Security Features

### Tool Whitelisting
```bash
# Only allow specific tools
prompd mcp start --allowed-tools research,coder,translator
```

### Request Size Limits
```bash
# Limit request payload size
prompd mcp start --max-request-size 5000
```

### Parameter Validation
- **Type Checking** - Validates parameter types (string, number, boolean, etc.)
- **Required Fields** - Enforces required parameters
- **Pattern Matching** - Regex validation for string parameters  
- **Range Validation** - Min/max constraints for numbers
- **Enum Validation** - Allowed value lists

## Architecture

### MCP Server (`PrompdMCPServer`)
- **Dynamic ES Module Imports** - Compatible with MCP SDK
- **Dual Tool Support** - Handles both .prompd and .prompdflow files
- **Execution Modes** - Template rendering or full LLM execution
- **Parameter Validation** - JSON Schema-based validation
- **Error Handling** - Comprehensive error reporting

### Workflow Engine (`WorkflowExecutor`)
- **File Loading** - Supports JSON and YAML workflow formats
- **Graph Validation** - Validates node connections and references
- **Sequential Execution** - Simple execution engine (extensible)
- **Parameter Mapping** - Maps workflow parameters to MCP interface

## Configuration

### Global Config Location
`~/.prompd/mcp-config.json`

### Config File Format
```json
{
  "tools": {
    "research-assistant": {
      "type": "prompt",
      "file": "/path/to/research.prompd",
      "added": "2025-08-25T04:18:47.132Z"
    },
    "user-onboarding": {
      "type": "workflow", 
      "file": "/path/to/onboarding.prompdflow",
      "added": "2025-08-25T04:20:15.456Z"
    }
  }
}
```

## Integration Examples

### Claude Desktop Setup
1. Run: `prompd mcp config --output claude-config.json`
2. Add configuration to Claude Desktop settings
3. Restart Claude Desktop
4. Your prompts/workflows appear as available tools

### Custom MCP Client
```javascript
// Connect to Prompd MCP server via stdio
const client = new MCPClient();
await client.connect('stdio', { command: 'prompd', args: ['mcp', 'start'] });

// List available tools
const tools = await client.request('tools/list');
console.log(tools); // Shows both prompts and workflows

// Execute a workflow
const result = await client.request('tools/call', {
  name: 'user-onboarding',
  arguments: { email: 'user@example.com', plan: 'pro' }
});
```

## Advanced Usage

### Multi-Directory Registration
```bash
# Register from multiple sources
prompd mcp start --directory ./prompts --directory ./workflows --tool custom:./special.prompd
```

### Environment-Specific Execution
```bash
# Development
prompd mcp start --provider ollama --model llama2

# Production  
prompd mcp start --execute --provider openai --model gpt-4 --allowed-tools prod-tools
```

### Workflow Development Cycle
1. **Design** workflows in prompd-IDE visual editor
2. **Export** .prompdflow files to workflows directory
3. **Register** with `prompd mcp add workflow name`
4. **Test** via Claude Desktop or custom MCP client
5. **Deploy** with `prompd mcp start` in production

## Future Enhancements

### Planned Features
- **Advanced Workflow Execution** - Full node graph execution with conditions/loops
- **Real-time Updates** - Hot-reload workflows when files change
- **Workflow Debugging** - Breakpoints and step-through execution
- **HTTP/WebSocket Transports** - Beyond stdio for web integration
- **Workflow Composition** - Chain workflows together
- **Performance Monitoring** - Execution metrics and profiling

### Integration Roadmap
- **Python CLI** - Port MCP integration to Python implementation
- **Go CLI** - Port MCP integration to Go implementation  
- **VS Code Extension** - Direct MCP server from prompd-IDE
- **Web Interface** - Browser-based workflow execution
- **API Gateway** - REST API wrapper around MCP tools

This integration transforms Prompd from a file format into a **complete AI automation platform** accessible through the standardized MCP protocol.