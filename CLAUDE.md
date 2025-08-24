# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Prompd format specification and implementation repository. Prompd (`.prompd` files) is a structured format for creating reusable, configurable AI prompts that combines YAML frontmatter for parameter definition with markdown content for prompt instructions.

## Architecture & Structure

The repository contains multiple implementations and tools for the Prompd format:

### Core Components

1. **CLI Implementations** (`cli/prompd/`): 
   - **Python CLI** (`cli/prompd/python/`): Full-featured CLI with LLM provider support, version control, and git integration
   - **Go CLI** (`cli/prompd/go/`): Lightweight, zero-dependency CLI for core operations

2. **Documentation** (`docs/`): Complete format specification, CLI reference, and architectural guides

3. **Examples** (`examples/`): Sample `.prompd` files organized by complexity (basic, advanced, features)

4. **VS Code Extension** (`vscode-extension/`): Language support with syntax highlighting and IntelliSense

### Prompd File Structure

Each `.prompd` file consists of:
- **YAML Frontmatter**: Metadata, parameter definitions, validation rules
- **Markdown Content**: Prompt instructions with `{variable}` substitution

Key features:
- Parameter validation (types, ranges, patterns)
- Default values for optional parameters
- Complex data structures (objects, arrays)
- Conditional logic with template syntax
- Security guidelines and error handling

## Development Commands

### Python CLI Development

The Python CLI is the primary implementation with full LLM integration:

```bash
# Install from source (development mode)
cd cli/prompd/python
pip install -e .

# Install with development dependencies
pip install -e ".[dev]"

# Run tests
python run_tests.py

# Run full test suite
pytest tests/

# Lint and format code
black prompd/
ruff check prompd/
```

### Go CLI Development

The Go CLI provides a lightweight, zero-dependency alternative:

```bash
# Build for current platform
cd cli/prompd/go
go mod tidy
go build -o prompd ./cmd/prompd

# Build for all platforms (from repository root)
./build.sh          # Linux/macOS
build.bat           # Windows

# Test the build
./prompd validate examples/basic/example.prompd
./prompd list examples/
```

### VS Code Extension Development

```bash
cd vscode-extension
npm install
npm run compile
```

## Key Implementation Notes

### Parameter Substitution
- Variables use `{variable_name}` syntax in markdown content
- Access nested inputs with `{inputs.field_name}`
- Conditional logic uses `{%- if ... %}` template syntax

### Validation Requirements
When implementing PMD parsers or runners:
1. Validate all required parameters are provided
2. Check parameter types match specification
3. Apply pattern validation for strings with regex
4. Enforce min/max constraints for numeric values
5. Provide clear error messages for validation failures

### Security Considerations
- Never include API keys or secrets directly in PMD files
- Sanitize all parameter inputs to prevent injection
- Validate file paths to prevent directory traversal
- Use environment variables for sensitive configuration

### File Naming Conventions
- Prompd files: `kebab-case.prompd` (e.g., `fetch-ai-articles.prompd`)
- Variables: `snake_case` (e.g., `max_word_count`)
- Prompt names: `kebab-case` matching the filename

## Testing Approach

### Python CLI Testing
```bash
# Quick validation test
python cli/prompd/python/run_tests.py

# Full test suite
cd cli/prompd/python && pytest tests/

# Test with coverage
pytest --cov=prompd tests/
```

### Go CLI Testing
```bash
# Build and test basic functionality
cd cli/prompd/go
go build -o prompd ./cmd/prompd
./prompd validate ../../examples/basic/example.prompd
./prompd list ../../examples/
```

### Prompd File Testing
When modifying `.prompd` files:
1. Validate YAML frontmatter syntax
2. Ensure all referenced variables are defined
3. Test with default parameter values
4. Test with edge case values
5. Verify parameter substitution works correctly
6. Check conditional logic branches

## Common Development Tasks

### Creating New Prompd Files
1. Start with YAML frontmatter between `---` markers
2. Define required metadata: `name`, `description`, `version`
3. Add `parameters` array with parameter definitions
4. Write markdown content with `{variable}` placeholders
5. Add validation rules and defaults
6. Test parameter substitution

### Adding CLI Features
- **Python CLI**: Modify modules in `cli/prompd/python/prompd/`
- **Go CLI**: Edit source files in `cli/prompd/go/cmd/prompd/`
- Both CLIs should maintain feature parity for core operations

### Documentation Updates
Documentation is in `docs/` directory:
- `docs/FORMAT.md`: Complete format specification
- `docs/CLI.md`: CLI command reference
- Maintain consistent formatting and update examples

### Version Management & Release Strategy

**Important:** PyPI does not allow overwriting existing versions. Once a version is published, it's permanent.

**Best Practices:**
- Use smaller increments for minor fixes (0.2.1 → 0.2.2 rather than 0.2.1 → 0.3.0)
- Test thoroughly before publishing to PyPI
- Consider using pre-release versions for testing (e.g., 0.2.2rc1)

**Version Update Locations:**
When bumping versions, update these files:
- `cli/prompd/python/pyproject.toml` - Package version
- `cli/prompd/python/prompd/__init__.py` - Module version  
- `cli/prompd/python/prompd/cli.py` - CLI version display
- `vscode-extension/package.json` - Extension version

**Release Process:**
1. Update all version numbers
2. Build Python package: `python -m build`
3. Build Go binaries: `./build.sh`
4. Upload to PyPI: `python -m twine upload dist/prompd-X.Y.Z*`
5. Create GitHub release with Go binaries