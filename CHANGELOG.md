# Changelog

All notable changes to Prompd will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2024-08-24

### Added
- Go CLI implementation for lightweight, zero-dependency operations
- Cross-platform binary builds (Windows, Linux, macOS Intel/ARM)
- Backward compatibility for both `parameters` and `variables` field names in YAML
- Enhanced validation with better error messages
- Improved VS Code extension with better IntelliSense

### Fixed
- Go CLI parser now correctly handles both parameter field formats
- Python CLI version display now shows correct version
- Test suite improvements and fixes
- Import cleanup in Go codebase

### Changed
- Updated all components to version 0.2.1
- Improved CLAUDE.md documentation for development workflow
- Enhanced build process for multiple CLI implementations

## [0.2.0] - 2024-08-21

### Added
- Initial release of Prompd CLI
- Support for OpenAI, Anthropic, and Ollama providers
- YAML frontmatter with Markdown content format
- Parameter system with type validation
- Git-integrated version management commands
- Comprehensive validation system
- Variable substitution with Jinja2 support
- VS Code extension with syntax highlighting
- Full documentation suite

### Features
- `prompd execute` - Execute prompts with any LLM provider
- `prompd validate` - Validate .prompd file syntax
- `prompd version` - Manage semantic versions
  - `bump` - Increment version with git tags
  - `history` - View version history
  - `diff` - Compare versions
  - `suggest` - Get intelligent bump suggestions
- `prompd list` - List available prompts
- `prompd show` - Display prompt structure
- `prompd providers` - List available providers

### Documentation
- Complete format specification
- CLI reference guide
- VS Code extension documentation
- Registry roadmap for Phase 2

## [0.1.0] - 2024-08-21

### Added
- Initial project structure
- Basic CLI framework
- Core models and parser
- Provider abstraction layer

---

## Roadmap

### Phase 1 (Current) ✅
- Core CLI functionality
- File format specification
- Provider integrations
- VS Code extension

### Phase 2 (Planned)
- Package registry (npm-style)
- Publishing and discovery
- Dependency management
- Private registries

### Phase 3 (Future)
- Web UI
- Team collaboration
- Analytics and metrics
- CI/CD integrations