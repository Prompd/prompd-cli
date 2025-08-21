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