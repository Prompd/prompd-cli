# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Prompd format specification and implementation repository. Prompd (`.prompd` files) is a structured format for creating reusable, configurable AI prompts that combines YAML frontmatter for parameter definition with markdown content for prompt instructions.

## Architecture & Structure

### Core Components

1. **Prompd Format Specification** (`PMD_Format_Documentation.md`): The complete specification and documentation for the Prompd format, including schema, best practices, and comparison with other formats.

2. **Prompt Templates** (`prompts/` directory): Contains `.prompd` files that define reusable prompt templates with parameters and validation.

3. **Registry System** (`registry.json`): Tracks processed items to enable deduplication across multiple runs.

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

### Prompd CLI

The repository includes a Python CLI tool for working with .prompd files:

```bash
# Install the CLI
pip install -e .

# Validate a .prompd file
prompd validate prompts/fetch-ai-literacy-articles.prompd

# List available .prompd files
prompd list

# Show .prompd file structure and parameters
prompd show prompts/fetch-ai-literacy-articles.prompd

# Execute a .prompd file with LLM provider
prompd execute example.prompd --provider openai --model gpt-4 -p name=Alice

# Execute with output to file
prompd execute example.prompd --provider anthropic --model claude-3-sonnet -p name=Bob -o output.txt
```

### Testing

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run tests with coverage
pytest --cov=pmd
```

### Git Operations

Standard git workflow applies:
```bash
# Check status
git status

# Stage changes
git add <file>

# Commit changes
git commit -m "message"
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
- PMD files: `kebab-case.pmd` (e.g., `fetch-ai-articles.pmd`)
- Variables: `snake_case` (e.g., `max_word_count`)
- Prompt names: `kebab-case` matching the filename

## Testing Approach

When modifying PMD files or creating new ones:
1. Validate YAML frontmatter syntax
2. Ensure all referenced variables are defined
3. Test with default parameter values
4. Test with edge case values
5. Verify parameter substitution works correctly
6. Check conditional logic branches

## Common Tasks

### Creating a New PMD File
1. Start with YAML frontmatter between `---` markers
2. Define required metadata: `name`, `description`
3. Add `variables` array with parameter definitions
4. Write markdown content with `{variable}` placeholders
5. Add validation rules and defaults
6. Test parameter substitution

### Updating Documentation
The main documentation is in `PMD_Format_Documentation.md`. When updating:
- Maintain consistent formatting
- Update the feature comparison matrix if adding capabilities
- Include examples for new features
- Update version history if making breaking changes

### Working with Registry
The `registry.json` file tracks processed items:
- Start with empty `{}` for first run
- Save the updated registry after each run
- Pass previous registry content as `seen_registry_json` parameter for deduplication