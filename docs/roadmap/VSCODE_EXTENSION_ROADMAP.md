# VS Code Extension for Prompd

## Overview

The Prompd VS Code extension will provide comprehensive IDE support for .prompd files, including syntax highlighting, IntelliSense, validation, and direct execution capabilities.

## Core Features

### 1. Syntax Highlighting & Language Support

#### File Association
- Register `.prompd` file extension
- Custom icon for .prompd files in explorer
- Automatic language detection

#### Syntax Highlighting
```yaml
# YAML frontmatter highlighting
---
name: my-prompt
version: 1.0.0
parameters:
  - name: topic     # Parameter definitions
    type: string
---

# Markdown section headers
# System

# Variable reference highlighting
Please discuss {topic} in detail.
```

### 2. IntelliSense & Autocompletion

#### YAML Frontmatter
- Schema-based autocompletion for metadata fields
- Parameter type suggestions (string, integer, boolean, array, object)
- Built-in field validation

#### Variable References
- Autocomplete `{variable}` references based on defined parameters
- Show parameter descriptions on hover
- Warn about undefined variables

#### Snippets
```json
{
  "prompd-basic": {
    "prefix": "prompd",
    "body": [
      "---",
      "name: ${1:prompt-name}",
      "description: ${2:Description}",
      "version: 1.0.0",
      "parameters:",
      "  - name: ${3:param}",
      "    type: ${4|string,integer,boolean,array,object|}",
      "    required: ${5|true,false|}",
      "    description: ${6:Parameter description}",
      "---",
      "",
      "# ${7|System,Context,User,Response|}",
      "",
      "${8:Content with {${3:param}}}"
    ]
  }
}
```

### 3. Validation & Diagnostics

#### Real-time Validation
- YAML frontmatter structure validation
- Semantic version format checking
- Variable reference validation
- Parameter type checking

#### Problem Reporting
```typescript
// Example diagnostic messages
- ERROR: Undefined variable 'username' referenced in content
- WARNING: Version '1.0' should use semantic versioning (x.y.z)
- INFO: Parameter 'count' is defined but never used
```

### 4. Command Palette Integration

#### Available Commands
- `Prompd: Execute Current File` - Run with selected provider/model
- `Prompd: Validate File` - Run full validation
- `Prompd: Bump Version` - Semantic version bumping
- `Prompd: Show Preview` - Preview rendered prompt
- `Prompd: Export to JSON` - Convert to JSON format
- `Prompd: Create New Prompt` - Template wizard

### 5. CodeLens & Inline Actions

#### Above Frontmatter
```
▶ Run with OpenAI | ▶ Run with Anthropic | 📋 Copy as JSON | 🔍 Validate
---
name: my-prompt
```

#### Above Parameters
```
➕ Add Parameter | 🔧 Generate Type Definition
parameters:
```

### 6. Sidebar Panel

#### Prompd Explorer
```
PROMPD EXPLORER
├── 📁 Project Prompts
│   ├── 📄 code-reviewer.prompd (v1.2.0)
│   ├── 📄 bug-finder.prompd (v2.0.1)
│   └── 📄 test-generator.prompd (v1.0.0)
├── 📁 Installed Packages
│   ├── 📦 @common/base-prompts
│   └── 📦 @utils/helpers
└── ⚙️ Configuration
    ├── Default Provider: OpenAI
    └── Default Model: gpt-4
```

### 7. Execution & Testing

#### Quick Execution Panel
```typescript
interface ExecutionConfig {
  provider: 'openai' | 'anthropic' | 'ollama';
  model: string;
  parameters: Record<string, any>;
  apiKey?: string;
}
```

#### Test Parameter Sets
- Save multiple parameter configurations
- Quick switch between test scenarios
- Parameter validation before execution

### 8. Preview & Documentation

#### Live Preview
- Rendered markdown preview
- Variable substitution preview
- Side-by-side editing

#### Hover Documentation
- Parameter descriptions
- Type information
- Usage examples

## Technical Implementation

### Extension Structure
```
vscode-prompd/
├── package.json                 # Extension manifest
├── src/
│   ├── extension.ts            # Main entry point
│   ├── language/
│   │   ├── syntaxes/
│   │   │   └── prompd.tmLanguage.json
│   │   ├── configuration.json
│   │   └── snippets.json
│   ├── providers/
│   │   ├── completionProvider.ts
│   │   ├── hoverProvider.ts
│   │   ├── diagnosticProvider.ts
│   │   └── codeLensProvider.ts
│   ├── commands/
│   │   ├── executeCommand.ts
│   │   ├── validateCommand.ts
│   │   └── versionCommand.ts
│   ├── views/
│   │   ├── prompdExplorer.ts
│   │   └── executionPanel.ts
│   └── utils/
│       ├── parser.ts
│       ├── validator.ts
│       └── executor.ts
├── syntaxes/
│   └── prompd.tmLanguage.json
├── language-configuration.json
├── icons/
│   └── prompd-icon.svg
└── README.md
```

### Language Server Protocol (LSP)

Consider implementing a Language Server for advanced features:
- Cross-editor support (Neovim, Sublime, etc.)
- Better performance for large projects
- Reusable validation logic from CLI

### Integration with CLI

```typescript
// Reuse prompd CLI functionality
import { execSync } from 'child_process';

function validatePrompdFile(filePath: string): ValidationResult {
  const result = execSync(`prompd validate "${filePath}" --json`);
  return JSON.parse(result.toString());
}

function executePrompdFile(
  filePath: string, 
  config: ExecutionConfig
): ExecutionResult {
  const params = Object.entries(config.parameters)
    .map(([k, v]) => `-p ${k}="${v}"`)
    .join(' ');
  
  const result = execSync(
    `prompd execute "${filePath}" ` +
    `--provider ${config.provider} ` +
    `--model ${config.model} ${params}`
  );
  return JSON.parse(result.toString());
}
```

## Development Phases

### Phase 1: Basic Language Support (Week 1-2)
- [ ] File association and icon
- [ ] Basic syntax highlighting
- [ ] Language configuration
- [ ] Simple snippets

### Phase 2: IntelliSense (Week 3-4)
- [ ] YAML schema validation
- [ ] Autocompletion provider
- [ ] Hover provider
- [ ] Variable reference completion

### Phase 3: Validation & Diagnostics (Week 5-6)
- [ ] Real-time validation
- [ ] Diagnostic provider
- [ ] Problem matcher
- [ ] Quick fixes

### Phase 4: Commands & Execution (Week 7-8)
- [ ] Command palette commands
- [ ] CodeLens provider
- [ ] Execution integration
- [ ] Output channel

### Phase 5: Advanced Features (Week 9-10)
- [ ] Prompd Explorer view
- [ ] Preview panel
- [ ] Test parameter management
- [ ] Settings UI

### Phase 6: Polish & Release (Week 11-12)
- [ ] Documentation
- [ ] Examples and tutorials
- [ ] Marketplace preparation
- [ ] Testing and bug fixes

## VS Code Marketplace Publishing

### Requirements
- Publisher account
- Extension icon (128x128)
- README with screenshots
- CHANGELOG.md
- Categories and tags

### package.json Configuration
```json
{
  "name": "prompd",
  "displayName": "Prompd - Prompt Definition Language",
  "description": "Language support for .prompd files",
  "version": "0.1.0",
  "publisher": "logikbug",
  "engines": {
    "vscode": "^1.74.0"
  },
  "categories": [
    "Programming Languages",
    "Snippets",
    "Linters"
  ],
  "keywords": [
    "prompd",
    "prompt",
    "ai",
    "llm",
    "openai",
    "anthropic"
  ],
  "activationEvents": [
    "onLanguage:prompd",
    "workspaceContains:**/*.prompd"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "languages": [{
      "id": "prompd",
      "aliases": ["Prompd", "prompd"],
      "extensions": [".prompd"],
      "configuration": "./language-configuration.json"
    }],
    "grammars": [{
      "language": "prompd",
      "scopeName": "source.prompd",
      "path": "./syntaxes/prompd.tmLanguage.json"
    }]
  }
}
```

## Success Metrics

### Adoption
- Extension installs
- Daily/weekly active users
- GitHub stars

### Quality
- User ratings and reviews
- Bug report frequency
- Feature request patterns

### Performance
- Activation time
- Memory usage
- Response latency

## Future Enhancements

### AI-Powered Features
- Prompt optimization suggestions
- Parameter type inference
- Auto-generate test cases
- Similar prompt recommendations

### Collaboration
- Share prompts via Live Share
- Git integration for version tracking
- Review and comment on prompts

### Ecosystem Integration
- Direct publish to registry
- Import from OpenAI playground
- Export to various formats
- Integration with API testing tools

## Resources

### Development
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [TextMate Grammar](https://macromates.com/manual/en/language_grammars)

### Examples
- [YAML Language Support](https://github.com/redhat-developer/vscode-yaml)
- [Markdown Language Features](https://github.com/microsoft/vscode/tree/main/extensions/markdown-language-features)

---

*Estimated Timeline: 12 weeks for full-featured extension*
*Quick MVP: 2-3 weeks for basic syntax highlighting and validation*