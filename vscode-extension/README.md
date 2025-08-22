# Prompd VS Code Extension

Official VS Code extension for Prompd (.prompd) files - structured prompt definitions for LLMs.

## Features

### Syntax Highlighting
- Full syntax highlighting for .prompd files
- YAML frontmatter highlighting
- Variable reference highlighting
- Markdown section support

### IntelliSense
- Auto-completion for variables
- Parameter type suggestions
- Hover information for variables
- Snippets for common patterns

### Validation
- Real-time syntax validation
- Undefined variable detection
- Semantic version checking
- Parameter type validation

### Execution
- Execute prompts directly from VS Code
- Support for multiple LLM providers (OpenAI, Anthropic, Ollama)
- Parameter input interface
- Output in VS Code terminal

### Commands

#### Execution
- **Prompd: Execute** - Run the current .prompd file
- **Prompd: Execute Specific Version** - Execute a specific version (1.2.3, HEAD, commit hash)
- **Prompd: Preview** - Preview rendered prompt

#### Validation & Versioning  
- **Prompd: Validate** - Validate the current file
- **Prompd: Bump Version** - Increment semantic version
- **Prompd: Show Version History** - Display version history

#### Git Integration
- **Prompd: Git Add** - Add file to git staging area
- **Prompd: Git Commit** - Commit file with message
- **Prompd: Checkout Version** - Checkout specific version to current or new file

## Requirements

- Prompd CLI must be installed: `pip install prompd`
- VS Code 1.74.0 or higher

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Prompd"
4. Click Install

Or install from the command line:
```bash
code --install-extension logikbug.prompd
```

## Usage

### Creating a New Prompd File

1. Create a new file with `.prompd` extension
2. Type `prompd` and press Tab to insert the basic template
3. Fill in your prompt metadata and content

### Running a Prompt

1. Open a .prompd file
2. Click the "Execute" button in the editor toolbar, or
3. Press Ctrl+Shift+P and run "Prompd: Execute"
4. Enter parameter values when prompted
5. Select LLM provider and model
6. View results in the output panel

### Version Management

#### Execute a Specific Version
1. Right-click on a .prompd file
2. Select "Prompd: Execute Specific Version"
3. Enter version (e.g., 1.2.3, HEAD, commit hash)
4. Configure parameters and provider
5. View results from that version

#### Checkout a Version
1. Open a .prompd file
2. Run "Prompd: Checkout Version"
3. Enter version to checkout
4. Choose to overwrite current file or save to new file

#### Git Operations
1. Make changes to your .prompd file
2. Run "Prompd: Git Add" to stage
3. Run "Prompd: Git Commit" and enter message
4. Use "Prompd: Show Version History" to see all versions

### Snippets

| Prefix | Description |
|--------|-------------|
| `prompd` | Create a new Prompd file |
| `param` | Add a parameter definition |
| `system` | Add a System section |
| `context` | Add a Context section |
| `user` | Add a User section |
| `response` | Add a Response section |
| `var` | Insert a variable reference |
| `if` | Add a Jinja2 if statement |
| `for` | Add a Jinja2 for loop |

## Extension Settings

This extension contributes the following settings:

* `prompd.defaultProvider`: Default LLM provider (openai, anthropic, ollama)
* `prompd.defaultModel`: Default model name
* `prompd.validateOnSave`: Validate .prompd files on save
* `prompd.showCodeLens`: Show inline execution buttons

## Known Issues

- First release, please report issues on GitHub

## Release Notes

### 0.2.0

New features:
- Git integration commands (add, commit, checkout)
- Execute specific versions of prompts
- Version history viewer
- Enhanced context menu options

### 0.1.0

Initial release:
- Syntax highlighting
- Basic IntelliSense
- Validation support
- Execution commands
- Snippets

## Contributing

Contributions are welcome! Please visit our [GitHub repository](https://github.com/Logikbug/prompt-markdown).

## License

MIT License - See LICENSE file for details