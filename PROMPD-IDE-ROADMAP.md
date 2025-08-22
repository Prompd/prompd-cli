# Prompd IDE Roadmap
*From VS Code Extension to Native Prompt Engineering IDE*

## Vision
Build a prompt engineering-first IDE by forking VS Code. Create the development environment that treats prompts as first-class citizens with native support for versioning, parameters, chaining, and execution.

## What We've Built (Extension Phase)

### ✅ Core Architecture Completed
- **Secure Command Execution**: Replaced all `exec()` with `spawn()` using `shell: false` to prevent injection
- **Parameter Management**: Postman-style sidebar with provider/model selection and parameter inputs
- **Git Integration**: Version control for prompts with commit, checkout, and history commands
- **Content Security Policy**: All webviews hardened with CSP headers
- **Input Sanitization**: XSS prevention with HTML escaping
- **Secure Temp Files**: Cryptographically random temporary file names

### 🏗️ Security Patterns Established

#### Command Execution Pattern
```typescript
// SECURE: Uses spawn with shell: false
async function executeSecureCommand(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number }
): Promise<CommandResult>

// Helper for building prompd command args
function buildPrompdArgs(action: string, filePath: string, options: Record<string, any>): string[]
```

#### Webview Security Pattern
```typescript
// CSP Helper
function getWebviewCSP(webview: vscode.Webview): string
// HTML Escaping
function escapeHtml(unsafe: string): string
// Resource Restriction
localResourceRoots: [vscode.Uri.file(path.dirname(documentUri.fsPath))]
```

### 🎨 UI Architecture
- **Sidebar as Primary Interface**: Single source of truth for execution controls
- **No CodeLens Clutter**: Removed redundant inline buttons
- **Postman-Style Design**: Provider/model dropdowns, parameter inputs, execute buttons
- **Adhoc Prompt Support**: Textarea for quick prompt testing with parameter substitution

## Fork Strategy: Extension → Native IDE

### Phase 1: Fork & Setup (Week 1)
1. **Fork VS Code** to `Logikbug/prompd-ide`
2. **Port Extension** as built-in extension to `extensions/prompd/`
3. **Study Codebase**: Understand extension host, workbench, and command systems
4. **Maintain Compatibility**: Keep working while learning

### Phase 2: Native Integration (Weeks 2-4)
1. **Native Sidebar Panel**: Move from extension webview to workbench panel
2. **Command Palette Integration**: Add native prompt commands
3. **File Explorer Integration**: `.prompd` file icons and context menus  
4. **Status Bar Integration**: Show active provider/model

### Phase 3: Advanced Features (Months 2-3)
1. **Visual Prompt Chaining**: Drag-and-drop workflow builder
2. **Parameter Debugging**: Step through prompt executions with variable inspection
3. **Response Diff View**: Compare outputs across prompt versions
4. **Registry Integration**: Native package management UI

### Phase 4: Killer Features (Months 4-6)
1. **Prompt Collaboration**: Multi-user prompt editing
2. **A/B Testing**: Compare prompt effectiveness
3. **Cost Analytics**: Track API usage and costs
4. **Intelligent Suggestions**: AI-powered prompt improvements

## Key VS Code Architecture Points

### Extension Host Location
- `src/vs/workbench/services/extensions/` - Extension system
- `extensions/` - Built-in extensions

### UI Components
- **Sidebar**: `src/vs/workbench/contrib/` 
- **Command Palette**: `src/vs/workbench/contrib/quickaccess/`
- **Status Bar**: `src/vs/workbench/browser/parts/statusbar/`
- **Panels**: `src/vs/workbench/browser/parts/panel/`

### File Associations
- `src/vs/workbench/services/textfile/` - File type handling
- `src/vs/platform/files/` - File system operations

## Native Features to Build

### 1. Prompt Chaining Engine
```typescript
interface PromptChain {
    id: string;
    steps: PromptStep[];
    variables: Record<string, any>;
}

interface PromptStep {
    prompt: string;
    provider: string;
    model: string;
    parameters: Record<string, any>;
    outputVariable?: string;
}
```

### 2. Visual Workflow Editor
- Canvas-based drag & drop
- Visual connections between prompts
- Real-time parameter flow visualization
- Debugging with step-through execution

### 3. Registry Integration
- Native package explorer
- One-click prompt installation
- Dependency resolution UI
- Publishing workflow

## Migration Strategy

### Keep What Works
- All security patterns (command execution, CSP, sanitization)
- Core CLI integration
- Parameter validation logic
- Git workflow integration

### Make Native
- Sidebar panel (no more webview)
- Command palette commands
- File explorer integration
- Status bar provider indicator

### Add New Capabilities
- Visual prompt chaining
- Multi-file prompt projects
- Collaborative editing
- Advanced debugging tools

## Technical Decisions Made

### ✅ Security First
- No shell command execution
- All user inputs sanitized
- CSP on all HTML content
- Restricted resource access

### ✅ Sidebar-Centric UX
- Single execution interface
- No UI clutter
- Postman-style familiarity

### ✅ Git as Version Control
- Leverage existing git integration
- Version prompts like code
- Diff support for iterations

## Competitive Advantage

### vs Cursor/GitHub Copilot
- **They do**: Code generation
- **We do**: Prompt engineering tooling

### vs Existing Prompt Tools
- **They do**: Web apps, copy-paste workflows
- **We do**: IDE-native, version controlled, parameterized prompts

### vs Building Extension
- **Extension limitations**: Webviews, API restrictions, performance
- **Native advantages**: Full platform access, custom UI, deep integration

## Success Metrics

### Developer Adoption
- Daily active users of Prompd IDE
- Prompts created and executed
- Registry package downloads

### Enterprise Traction  
- Teams using private registries
- Prompt collaboration usage
- Cost savings through optimization

### Ecosystem Growth
- Community-contributed prompt packages
- Integration partnerships (OpenAI, Anthropic, etc.)
- Developer tool integrations

## Open Questions for Native Development

1. **Theming**: How to integrate with VS Code's theme system?
2. **Performance**: How to handle long-running prompt executions?
3. **Persistence**: Where to store prompt chains and configurations?
4. **Updates**: How to handle fork maintenance and upstream merges?
5. **Distribution**: Electron app packaging and auto-updates?

## Next Immediate Steps

1. **Fork VS Code** → `Logikbug/prompd-ide`
2. **Copy extension code** → `extensions/prompd/`
3. **Study workbench structure** → Understand panel system
4. **Create native sidebar** → Replace webview with native UI
5. **Port command execution** → Use established security patterns

---

## Context for New Claude Session

**What we've accomplished:**
- Secure VS Code extension with parameter management
- Command injection prevention and CSP implementation  
- Postman-style UI for prompt execution
- Git integration for prompt versioning

**What we're building:**
- Native prompt engineering IDE based on VS Code fork
- Visual prompt chaining and workflow builder
- Registry system for prompt packages
- Professional tooling for AI development teams

**Current status:**
- Extension is production-ready and secure
- Ready to fork VS Code and begin native development
- Architecture patterns established and tested

**Files to reference:**
- `vscode-extension/src/extension.ts` - Main extension logic
- `vscode-extension/package.json` - Extension manifest
- This roadmap for architecture decisions

The vision is **Postman for AI prompts** built as a native IDE experience.