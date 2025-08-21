# Prompd CLI Reference

## Installation

```bash
pip install -e .
```

## Global Options

These options work with all commands:

- `--help` - Show help message
- `--version` - Show version number

## Commands

### `prompd execute`

Execute a .prompd file with an LLM provider.

```bash
prompd execute <file> --provider <provider> --model <model> [options]
```

#### Required Arguments
- `file` - Path to .prompd file
- `--provider` - LLM provider (openai, anthropic, ollama)
- `--model` - Model name (gpt-4, claude-3-opus, etc.)

#### Options
- `-p, --param KEY=VALUE` - Set parameter value (can use multiple times)
- `-f, --param-file FILE` - Load parameters from JSON file (can use multiple)
- `--api-key KEY` - Override API key for provider
- `-o, --output FILE` - Save response to file
- `--version VERSION` - Execute a specific version (e.g., '1.2.3', 'HEAD', commit hash)
- `-v, --verbose` - Show detailed execution information

#### Examples

```bash
# Basic execution
prompd execute prompt.prompd --provider openai --model gpt-4

# With parameters
prompd execute prompt.prompd --provider openai --model gpt-4 \
  -p language=Python \
  -p style=detailed

# With parameter file
prompd execute prompt.prompd --provider anthropic --model claude-3-opus \
  -f params.json

# Save output
prompd execute prompt.prompd --provider openai --model gpt-4 \
  -o response.txt

# Override API key
prompd execute prompt.prompd --provider openai --model gpt-4 \
  --api-key sk-...

# Execute a specific version
prompd execute prompt.prompd --provider openai --model gpt-4 \
  --version 1.2.3 -p name=Alice

# Execute last committed version
prompd execute prompt.prompd --provider openai --model gpt-4 \
  --version HEAD
```

### `prompd validate`

Validate a .prompd file's syntax and structure.

```bash
prompd validate <file> [options]
```

#### Arguments
- `file` - Path to .prompd file

#### Options
- `-v, --verbose` - Show detailed validation results
- `--git` - Include git history consistency checks
- `--version-only` - Only validate version-related aspects

#### Examples

```bash
# Basic validation
prompd validate prompt.prompd

# Detailed validation
prompd validate prompt.prompd --verbose

# Check git consistency
prompd validate prompt.prompd --git

# Version validation only
prompd validate prompt.prompd --version-only
```

#### Validation Checks
- YAML syntax validity
- Required fields presence
- Name format (kebab-case)
- Version format (semantic)
- Parameter definitions
- Variable references
- Type consistency

### `prompd git`

Git operations for .prompd files.

#### Subcommands

##### `prompd git add`

Add .prompd files to git staging area.

```bash
prompd git add <files...> [options]
```

Options:
- `-v, --verbose` - Show git output

Examples:
```bash
# Add single file
prompd git add prompts/my-prompt.prompd

# Add multiple files
prompd git add prompts/*.prompd
```

##### `prompd git remove`

Remove .prompd files from git tracking.

```bash
prompd git remove <files...> [options]
```

Options:
- `--cached` - Only remove from index, keep in working directory
- `-v, --verbose` - Show git output

Examples:
```bash
# Remove file completely
prompd git remove old-prompt.prompd

# Remove from tracking but keep file
prompd git remove old-prompt.prompd --cached
```

##### `prompd git status`

Show git status for .prompd files.

```bash
prompd git status [options]
```

Options:
- `-p, --path PATH` - Check status for specific path

Example:
```bash
prompd git status
```

##### `prompd git commit`

Commit staged .prompd files.

```bash
prompd git commit -m <message> [options]
```

Options:
- `-m, --message TEXT` - Commit message (required)
- `-a, --all` - Automatically stage all modified .prompd files

Examples:
```bash
# Commit staged files
prompd git commit -m "Update prompt parameters"

# Stage and commit all modified .prompd files
prompd git commit -m "Fix validation rules" --all
```

##### `prompd git checkout`

Checkout a specific version of a .prompd file.

```bash
prompd git checkout <file> <version> [options]
```

Arguments:
- `file` - Path to .prompd file
- `version` - Version to checkout (semantic version, tag, commit hash, HEAD, HEAD~1, etc.)

Options:
- `-o, --output FILE` - Output to different file instead of overwriting

Examples:
```bash
# Checkout version 1.2.3 (overwrites current file)
prompd git checkout prompts/my-prompt.prompd 1.2.3

# Checkout to a different file
prompd git checkout prompts/my-prompt.prompd 1.2.3 -o prompts/my-prompt-v1.2.3.prompd

# Checkout last committed version
prompd git checkout prompts/my-prompt.prompd HEAD

# Checkout previous commit
prompd git checkout prompts/my-prompt.prompd HEAD~1

# Checkout specific commit
prompd git checkout prompts/my-prompt.prompd abc1234
```

### `prompd version`

Manage semantic versions with git integration.

#### Subcommands

##### `prompd version bump`

Increment version and create git tag.

```bash
prompd version bump <file> <bump_type> [options]
```

Arguments:
- `file` - Path to .prompd file
- `bump_type` - Version increment type (major, minor, patch)

Options:
- `-m, --message TEXT` - Commit message
- `--dry-run` - Preview changes without applying

Examples:
```bash
# Patch version (1.0.0 -> 1.0.1)
prompd version bump prompt.prompd patch

# Minor version (1.0.0 -> 1.1.0)
prompd version bump prompt.prompd minor -m "Add new feature"

# Major version (1.0.0 -> 2.0.0)
prompd version bump prompt.prompd major --dry-run
```

##### `prompd version history`

Show version history from git tags.

```bash
prompd version history <file> [options]
```

Options:
- `-n, --limit NUMBER` - Number of versions to show (default: 10)

Example:
```bash
prompd version history prompt.prompd --limit 5
```

##### `prompd version diff`

Compare versions of a file.

```bash
prompd version diff <file> <version1> [version2]
```

Arguments:
- `version1` - First version to compare
- `version2` - Second version (default: HEAD)

Example:
```bash
# Compare two versions
prompd version diff prompt.prompd 1.0.0 2.0.0

# Compare with current
prompd version diff prompt.prompd 1.0.0
```

##### `prompd version validate`

Validate version consistency.

```bash
prompd version validate <file> [options]
```

Options:
- `--git` - Validate against git history

Example:
```bash
prompd version validate prompt.prompd --git
```

##### `prompd version suggest`

Get intelligent version bump suggestions.

```bash
prompd version suggest <file> [options]
```

Options:
- `--changes TEXT` - Description of changes made

Examples:
```bash
# Get suggestion based on changes
prompd version suggest prompt.prompd --changes "Added new feature"

# Auto-detect suggestion
prompd version suggest prompt.prompd
```

### `prompd list`

List available .prompd files in a directory.

```bash
prompd list [options]
```

#### Options
- `-p, --path DIR` - Directory to search (default: prompts)
- `-d, --detailed` - Show detailed information

#### Examples

```bash
# List files in default directory
prompd list

# List files in specific directory
prompd list --path ./my-prompts

# Show detailed information
prompd list --detailed
```

### `prompd show`

Display the structure and parameters of a .prompd file.

```bash
prompd show <file>
```

#### Output Includes
- Name and version
- Description
- Parameter definitions
- Content structure
- Required fields

### `prompd provider`

Manage LLM providers including custom/local providers.

#### Subcommands

##### `prompd provider list`

List all available providers (built-in and custom).

```bash
prompd provider list
```

Shows:
- Provider name and type (Built-in/Custom)
- Available models
- Connection status

Example output:
```
┌─ Provider ─────────────────────────────┐
│ openai (Built-in)                      │
│ Models: gpt-4, gpt-4-turbo, gpt-4o ... │
└────────────────────────────────────────┘
┌─ Provider ─────────────────────────────┐
│ local-ollama (Custom)                  │
│ Models: llama3.2, qwen2.5             │
└────────────────────────────────────────┘
```

##### `prompd provider add`

Add a custom LLM provider with OpenAI-compatible API.

```bash
prompd provider add <name> <base_url> <models...> [options]
```

**Arguments:**
- `name` - Provider name (e.g., 'local-ollama', 'groq-api')
- `base_url` - API endpoint URL (e.g., 'http://localhost:11434/v1')
- `models` - Space-separated list of model names

**Options:**
- `--api-key KEY` - API key for the provider (optional)
- `--type TYPE` - Provider type (default: openai-compatible)

**Examples:**

```bash
# Add local Ollama instance
prompd provider add local-ollama http://localhost:11434/v1 \
  llama3.2 qwen2.5 mixtral

# Add Groq with API key
prompd provider add groq https://api.groq.com/openai/v1 \
  llama-3.1-8b-instant mixtral-8x7b-32768 \
  --api-key gsk_...

# Add local LM Studio
prompd provider add lmstudio http://localhost:1234/v1 \
  local-model

# Add Together AI
prompd provider add together https://api.together.xyz/v1 \
  mistralai/Mixtral-8x7B-Instruct-v0.1 \
  --api-key your-api-key
```

##### `prompd provider show`

Show detailed information about a specific provider.

```bash
prompd provider show <name>
```

**Example:**
```bash
prompd provider show local-ollama
```

Output includes:
- Provider type (Built-in/Custom)
- Base URL (for custom providers)
- API key status
- Available models
- Configuration details

##### `prompd provider remove`

Remove a custom provider.

```bash
prompd provider remove <name> [options]
```

**Options:**
- `-y, --yes` - Skip confirmation prompt

**Examples:**
```bash
# Remove with confirmation
prompd provider remove local-ollama

# Remove without confirmation
prompd provider remove groq-api --yes
```

#### Custom Provider Configuration

Custom providers are stored in `~/.prompd/config.yaml`:

```yaml
custom_providers:
  local-ollama:
    base_url: http://localhost:11434/v1
    models:
      - llama3.2
      - qwen2.5
    api_key: null
    type: openai-compatible
    enabled: true
```

#### Supported Provider Types

Currently supported provider types:
- `openai-compatible` - OpenAI Chat Completions API format

#### OpenAI-Compatible APIs

Many LLM providers support OpenAI's chat completions API format:

| Provider | Base URL | Example Models |
|----------|----------|----------------|
| Ollama | `http://localhost:11434/v1` | llama3.2, qwen2.5 |
| LM Studio | `http://localhost:1234/v1` | local-model |
| Groq | `https://api.groq.com/openai/v1` | llama-3.1-8b-instant |
| Together AI | `https://api.together.xyz/v1` | mistralai/Mixtral-8x7B |
| Perplexity | `https://api.perplexity.ai` | llama-3.1-sonar-small |
| Fireworks | `https://api.fireworks.ai/inference/v1` | accounts/fireworks/models/llama-v3p1-8b-instruct |

#### Using Custom Providers

Once added, custom providers work exactly like built-in providers:

```bash
# Execute with custom provider
prompd execute prompt.prompd \
  --provider local-ollama \
  --model llama3.2 \
  -p topic="machine learning"

# Use with any prompd command
prompd validate prompt.prompd  # Works with any provider
```

#### Example

```bash
prompd show prompt.prompd
```

### `prompd providers`

List available LLM providers and their models.

```bash
prompd providers
```

#### Output
- Available providers (openai, anthropic, ollama)
- Supported models for each provider
- Configuration status

## Configuration

### Environment Variables

```bash
# API Keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export OLLAMA_HOST="http://localhost:11434"

# Defaults
export PROMPD_DEFAULT_PROVIDER="openai"
export PROMPD_DEFAULT_MODEL="gpt-4"
```

### Configuration File

Create `~/.prompd/config.json`:

```json
{
  "default_provider": "openai",
  "default_model": "gpt-4",
  "timeout": 30,
  "max_retries": 3,
  "providers": {
    "openai": {
      "api_key": "sk-...",
      "organization": "org-...",
      "base_url": "https://api.openai.com/v1"
    },
    "anthropic": {
      "api_key": "sk-ant-...",
      "base_url": "https://api.anthropic.com"
    },
    "ollama": {
      "host": "http://localhost:11434"
    }
  }
}
```

### Parameter Files

JSON files for parameter values:

```json
{
  "language": "Python",
  "style": "detailed",
  "max_length": 500,
  "include_examples": true,
  "tags": ["web", "api", "security"]
}
```

Use with `-f` flag:
```bash
prompd execute prompt.prompd --provider openai --model gpt-4 -f params.json
```

## Parameter Precedence

Parameters are resolved in this order (highest to lowest priority):

1. Command-line parameters (`-p key=value`)
2. Parameter files (`-f file.json`)
3. Default values in .prompd file
4. Environment variables

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Validation error
- `3` - Provider error
- `4` - Configuration error
- `5` - File not found

## Working with Versions

### Using Specific Versions

There are multiple ways to work with specific versions of `.prompd` files:

#### 1. Execute a Specific Version Directly
Run a specific version without modifying your working directory:

```bash
# Execute semantic version 1.2.3
prompd execute my-prompt.prompd --provider openai --model gpt-4 \
  --version 1.2.3 -p name=Alice

# Execute the last committed version
prompd execute my-prompt.prompd --provider openai --model gpt-4 \
  --version HEAD

# Execute a specific commit
prompd execute my-prompt.prompd --provider openai --model gpt-4 \
  --version abc1234

# Execute previous commit
prompd execute my-prompt.prompd --provider openai --model gpt-4 \
  --version HEAD~1
```

#### 2. Checkout a Version to Working Directory
Retrieve a specific version and save it to disk:

```bash
# Checkout and overwrite current file
prompd git checkout prompts/my-prompt.prompd 1.2.3

# Checkout to a different file (preserve current)
prompd git checkout prompts/my-prompt.prompd 1.2.3 \
  -o prompts/my-prompt-v1.2.3.prompd

# Revert to last committed version
prompd git checkout prompts/my-prompt.prompd HEAD
```

#### 3. Compare Versions
See what changed between versions:

```bash
# Compare two specific versions
prompd version diff prompts/my-prompt.prompd 1.0.0 2.0.0

# Compare version with current working copy
prompd version diff prompts/my-prompt.prompd 1.0.0
```

#### 4. View Version History
See all available versions:

```bash
# Show version history with tags
prompd version history prompts/my-prompt.prompd

# Show last 5 versions
prompd version history prompts/my-prompt.prompd -n 5
```

### Version Workflow Example

```bash
# 1. Check current version
prompd show my-prompt.prompd  # Shows version: 1.0.0

# 2. Make changes to the file
edit my-prompt.prompd

# 3. Test changes
prompd execute my-prompt.prompd --provider openai --model gpt-4 \
  -p test=value

# 4. Compare with previous version
prompd version diff my-prompt.prompd 1.0.0

# 5. If changes are good, bump version
prompd version bump my-prompt.prompd minor -m "Add new parameters"
# Creates version 1.1.0 and git tag

# 6. If changes are bad, revert to previous
prompd git checkout my-prompt.prompd 1.0.0

# 7. Or test old version without changing files
prompd execute my-prompt.prompd --provider openai --model gpt-4 \
  --version 1.0.0 -p test=value
```

## Examples

### Complete Workflow

```bash
# 1. Create a prompt
cat > code-review.prompd << 'EOF'
---
name: code-reviewer
version: 1.0.0
parameters:
  - name: language
    type: string
    required: true
  - name: code
    type: string
    required: true
---

# System
You are an expert {language} code reviewer.

# User
Review this code:
```{language}
{code}
```
EOF

# 2. Validate it
prompd validate code-review.prompd

# 3. Execute it
prompd execute code-review.prompd \
  --provider openai \
  --model gpt-4 \
  -p language=Python \
  -p code="def add(a, b): return a + b"

# 4. Bump version after changes
prompd version bump code-review.prompd patch -m "Improve review criteria"

# 5. View history
prompd version history code-review.prompd
```

### Batch Processing

```bash
# Validate all prompts
for file in prompts/*.prompd; do
  echo "Validating $file"
  prompd validate "$file"
done

# Execute with same parameters
PARAMS="language=Python style=detailed"
for file in prompts/*.prompd; do
  prompd execute "$file" \
    --provider openai \
    --model gpt-4 \
    -p $PARAMS \
    -o "outputs/$(basename $file .prompd).txt"
done
```

### CI/CD Integration

```yaml
# GitHub Actions example
name: Validate Prompts
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
      - run: pip install prompd
      - run: |
          for file in prompts/*.prompd; do
            prompd validate "$file" --verbose
          done
```

## Troubleshooting

### Common Issues

#### "Missing required field 'name'"
The .prompd file must have a `name` field in the YAML frontmatter.

#### "Undefined variable 'X' referenced"
All variables used in content must be defined in the parameters section.

#### "Provider error: No API key"
Set the API key via environment variable or config file.

#### "Invalid semantic version"
Version must follow format: major.minor.patch (e.g., 1.2.3)

### Debug Mode

Use `-v/--verbose` flag for detailed output:

```bash
prompd execute prompt.prompd --provider openai --model gpt-4 -v
```

### Getting Help

```bash
# General help
prompd --help

# Command help
prompd execute --help
prompd version bump --help
```