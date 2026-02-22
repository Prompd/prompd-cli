# !!READONLY!!

# Complete Prompd Commands Reference

## Core Commands

### `prompd create` - Create new .prmd files
```bash
# Interactive mode - guides through creation
prompd create my-prompt.prmd --interactive
prompd create my-prompt.prmd -i

# Direct mode with metadata
prompd create my-prompt.prmd --name "My Prompt" --description "Does something useful" --author "John Doe"
prompd create my-prompt.prmd -n "My Prompt" -d "Does something useful" -a "John Doe"

# With template (smart defaults)
prompd create security-audit.prmd --template security
prompd create security-audit.prmd -t security

# With template and custom metadata
prompd create security-audit.prmd -t security -n "Security Audit" -d "Comprehensive security review"

# Available templates
prompd create prompt.prmd --template basic      # Simple prompt template
prompd create prompt.prmd --template analysis   # Analysis framework
prompd create prompt.prmd --template security   # Security review template
prompd create prompt.prmd --template code-review # Code review template
prompd create prompt.prmd --template creative   # Creative writing template

# Interactive mode with template selection
prompd create my-analysis.prmd -i  # Will prompt for template choice
```

### `prompd init` - Initialize new Prompd project
```bash
# Initialize project in current directory
prompd init

# Initialize project in specific directory
prompd init my-project

# Initialize with custom metadata
prompd init my-project --name "My Custom Project" --description "A custom project"
prompd init my-project --version "2.0.0" --author "John Doe"

# Initialize in existing directory (will prompt to overwrite)
prompd init . --name "Existing Project"
```

### `prompd validate` - Validate .prmd files
```bash
# Basic validation
prompd validate examples/basic/example.prmd

# Verbose validation with detailed output
prompd validate examples/basic/example.prmd --verbose

# Validate with git consistency check
prompd validate examples/basic/example.prmd --git

# Validate only version format
prompd validate examples/basic/example.prmd --version-only

# Validate section overrides against parent template
prompd validate examples/basic/example.prmd --check-overrides
```

### `prompd list` - List .prmd files
```bash
# List .prmd files in current directory only (default)
prompd list

# List .prmd files in specific directory only
prompd list --path examples/

# List .prmd files recursively from current directory (includes subdirectories)
prompd list --recursive
prompd list -r

# List .prmd files recursively from specific directory
prompd list --path examples/ --recursive

# List with detailed information (includes descriptions and metadata)
prompd list --detailed
prompd list -d

# Combine flags: recursive + detailed
prompd list -rd
prompd list --recursive --detailed
```

### `prompd show` - Display file structure
```bash
# Show basic structure
prompd show examples/basic/example.prmd

# Show with section IDs for override reference
prompd show examples/basic/example.prmd --sections

# Show with detailed section information
prompd show examples/basic/example.prmd --verbose
```

### `prompd explain` - Detailed information about files and packages
```bash
# Explain .prmd file
prompd explain examples/src/prompts/base-prompt.prmd
prompd explain examples/src/prompts/team-project-planner.prmd -d
prompd explain examples/src/prompts/api-development.prmd -dsh

# Explain package file
prompd explain my-package.pdpkg
prompd explain my-package.pdpkg -d

# Explain registry package
prompd explain @namespace/package
prompd explain @namespace/package -d
prompd explain @namespace/package -r custom-registry

Options:
  -d, --detailed          Show detailed information (full output)
  -s, --sections          Show section content previews (for .prmd)
  -h, --history           Show git version history (for .prmd)
  -r, --registry <name>   Specify registry (for package lookup)
  -v, --verbose           Enable verbose logging (debug output)
```

## Compilation & Execution

### `prompd compile` - Compile to various formats
```bash
# Basic compilation (markdown by default)
prompd compile examples/basic/example.prmd

# Compile with parameters
prompd compile examples/basic/example.prmd -p name="Alice" -p style="friendly"

# Compile with verbose output (includes metadata)
prompd compile examples/basic/example.prmd -p name="Alice" --verbose

# Compile to markdown explicitly
prompd compile examples/basic/example.prmd --to-markdown

# Compile to provider-specific JSON
prompd compile examples/basic/example.prmd --to-provider-json openai
prompd compile examples/basic/example.prmd --to-provider-json anthropic

# Compile with JSON parameters (complex objects)
prompd compile examples/nested-properties-test.prmd \
  -p user='{"name":"John","email":"john@example.com","role":"admin"}'

# Compile with parameters file
prompd compile examples/basic/example.prmd --params-file params.json
prompd compile examples/basic/example.prmd -f params.json

# Compile and save to file
prompd compile examples/basic/example.prmd -o output.md

# Compile from package reference
prompd compile @namespace/package@1.0.0/prompts/example.prmd
```

### `prompd run` - Execute with LLM providers
```bash
# Execute with OpenAI
prompd run examples/basic/example.prmd --provider openai --model gpt-4o -p name="Alice"

# Execute with Anthropic
prompd run examples/basic/example.prmd --provider anthropic --model claude-3-opus -p name="Bob"

# Execute with parameters file
prompd run examples/basic/example.prmd --provider openai --model gpt-4 --param-file params.json

# Execute specific version
prompd run examples/basic/example.prmd --provider openai --model gpt-4 --version 1.2.3

# Execute and save response
prompd run examples/basic/example.prmd --provider openai --model gpt-4 -o response.txt

# Show token usage
prompd run examples/basic/example.prmd --provider openai --model gpt-4 --show-usage

# Override API key
prompd run examples/basic/example.prmd --provider openai --model gpt-4 --api-key sk-...

# JSON output format
prompd run examples/basic/example.prmd --provider openai --model gpt-4 --format json
```

## Package Management

### `prompd package create` / `prompd pack` - Create packages
```bash
# Create package from directory (both commands are identical)
prompd package create ./my-project
prompd pack ./my-project

# Create with specific output name
prompd pack ./examples/basic ./basic-examples.pdpkg

# Override package metadata
prompd pack ./my-project --name "custom-name" --version "2.0.0"
prompd pack ./my-project -n "custom-name" -V "2.0.0"
prompd pack ./my-project --description "Custom description" --author "Me"
prompd pack ./my-project -d "Custom description" -a "Me"
```

### `prompd package validate` - Validate packages
```bash
# Validate a .pdpkg file
prompd package validate my-package.pdpkg
```

## Registry Operations

### `prompd login` - Authenticate with registry
```bash
# Interactive login
prompd login

# Login with username and password
prompd login --username myuser --password mypass
prompd login -u myuser --password mypass

# Login with API key
prompd login --api-key prompd_abc123...
prompd login -k prompd_abc123...

# Login to specific registry
prompd login --registry https://custom-registry.com
```

### `prompd logout` - Logout from registry
```bash
# Logout from default registry
prompd logout

# Logout from specific registry
prompd logout --registry prompdhub
```

### `prompd publish` - Publish packages
```bash
# Publish package to registry
prompd publish my-package.pdpkg

# Publish to specific namespace
prompd publish my-package.pdpkg --namespace @mycompany

# Publish to specific registry
prompd publish my-package.pdpkg --registry https://custom-registry.com

# Dry run (see what would be published)
prompd publish my-package.pdpkg --dry-run
prompd publish my-package.pdpkg -n
```

### `prompd search` - Search registry
```bash
# Search for packages
prompd search "database helper"

# Search with limit
prompd search "api" --limit 10
prompd search "api" -l 10

# Search in specific registry
prompd search "template" --registry prompdhub
```

### `prompd install` - Install packages
```bash
# Install latest version (automatically saves to manifest.json)
prompd install "@namespace/package"

# Install specific version
prompd install "@namespace/package@1.2.3"

# Install globally (system-wide)
prompd install "@namespace/package" --global

# Install as development dependency
prompd install "@namespace/package" --save-dev

# Install from specific registry
prompd install "@namespace/package" --registry https://custom-registry.com

# Install multiple packages
prompd install "@namespace/package1" "@namespace/package2"

# Install all dependencies from manifest.json
prompd install
```

### `prompd uninstall` - Uninstall packages
```bash
# Uninstall package
prompd uninstall "@namespace/package"

# Uninstall globally
prompd uninstall "@namespace/package" --global

# Remove from development dependencies
prompd uninstall "@namespace/package" --save-dev
```

### `prompd versions` - List package versions
```bash
# List all versions
prompd versions @namespace/package

# List from specific registry
prompd versions @namespace/package --registry prompdhub
```

### `prompd namespace` - Manage namespaces
```bash
# List your namespaces
prompd namespace list

# Show current namespace context
prompd namespace current

# Switch to different namespace
prompd namespace use @mycompany

# Create namespace
prompd namespace create @mycompany
```

## Dependency Management

### `prompd deps` - Analyze dependencies
```bash
# Analyze current project dependencies
prompd deps

# Analyze specific package
prompd deps @namespace/package@1.0.0

# Show dependency tree
prompd deps --tree

# Check for version conflicts
prompd deps --conflicts

# Include dev dependencies
prompd deps --dev

# Include peer dependencies
prompd deps --peer

# Set maximum tree depth
prompd deps --tree --depth 5
```

## Cache Management

### `prompd cache` - Manage package cache
```bash
# List cached packages
prompd cache list

# Clear entire cache
prompd cache clear

# Clear global cache only
prompd cache clear --global

# Clear local cache only
prompd cache clear --local

# Clear both caches
prompd cache clear --all
```

## Environment Variables
```bash
# Set API keys
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# Set registry URL
export PROMPD_REGISTRY_URL=https://registry.prompdhub.ai
```

## Parameter Types
```bash
# String parameters
-p name="John Doe"

# Boolean parameters
-p admin=true
-p debug=false

# Number parameters
-p count=42
-p price=19.99

# JSON object parameters
-p user='{"name":"John","email":"john@example.com"}'

# JSON array parameters
-p tags='["api","backend","nodejs"]'

# Load from file
--params-file config.json
--param-file params.json
```

## Package References
```bash
# Namespace/package format
@prompd.io/core-patterns@2.0.0

# Simple package
my-package@1.0.0

# Latest version
@namespace/package@latest

# Package with file path
@namespace/package@1.0.0/prompts/example.prmd
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Validation error
- `3` - Network/registry error
- `4` - Authentication error
- `5` - File not found
- `6` - Permission denied

## Getting Help

```bash
# General help
prompd --help

# Command-specific help
prompd compile --help
prompd package --help
prompd registry --help

# Version information
prompd --version
```