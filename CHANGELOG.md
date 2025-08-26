# Changelog

All notable changes to Prompd will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2025-01-26

### 🚀 Major Features Added

#### Provider API Key Management
- **Go & Python CLIs**: New `prompd provider setkey <provider> <key>` command for secure API key storage
- **Go & Python CLIs**: New `prompd provider removekey <provider>` command for key management
- **Go & Python CLIs**: Enhanced `prompd provider list` command shows configured providers

#### Enhanced Execute Command (Python CLI)
- **Python CLI**: New `--format json|text` option for structured output formats
- **Python CLI**: New `--show-usage` flag displays token usage statistics after execution
- **Python CLI**: Improved error handling and user feedback

#### Version Management Enhancement (Go CLI)  
- **Go CLI**: New `prompd version suggest <file>` command provides AI-powered version bump recommendations
- **Go CLI**: Intelligent analysis of changes to suggest patch/minor/major version increments

#### Updated Model Support
- **Go CLI**: Added support for latest Claude models (`claude-3-5-haiku-20241022`)
- **Go CLI**: Updated model priorities and availability listings
- **Python CLI**: Enhanced model configuration and provider support

### 🛠️ Improvements

#### Cross-Platform Compatibility
- **All CLIs**: Improved Windows console encoding support and output formatting
- **Go CLI**: Enhanced error messages and user experience consistency
- **Python CLI**: Better cross-platform configuration handling

#### Development Infrastructure
- **Repository**: Added comprehensive CI/CD pipeline (`.github/workflows/ci-cd.yml`)
- **Repository**: Enhanced project structure with better separation of concerns
- **Repository**: Improved test coverage and validation across all implementations

#### Documentation & Vision
- **Repository**: Complete architectural vision documented in `PROMPD-VISION.md`
- **Repository**: Future roadmap and breakthrough concepts captured in `PROMPD-FUTURE-VISION.md`
- **Repository**: Comprehensive component system architecture in `docs/COMPONENT-SYSTEM.md`
- **Repository**: Generator ecosystem design in `docs/GENERATOR-ECOSYSTEM.md`
- **Repository**: API integration patterns in `docs/PROMPD-API-INTEGRATION.md`

### 🐛 Bug Fixes

#### Python CLI
- **Fixed**: Parameter validation edge cases in complex workflows
- **Fixed**: Configuration file loading on different operating systems
- **Fixed**: Error handling for network timeouts and API failures

#### Go CLI  
- **Fixed**: Command-line argument parsing for special characters
- **Fixed**: File path handling on Windows systems
- **Fixed**: Memory usage optimization for large prompt files

#### Node.js CLI
- **Improved**: TypeScript type safety and test reliability
- **Enhanced**: Mock system architecture for better test isolation
- **Fixed**: Several test infrastructure issues (26 out of 32 tests now passing)

### 🔧 Technical Improvements

#### Security Enhancements
- **All CLIs**: Enhanced input validation and sanitization
- **All CLIs**: Improved API key storage security practices
- **All CLIs**: Better error messages that don't expose sensitive information

#### Performance Optimizations
- **Go CLI**: Reduced binary size and faster startup times
- **Python CLI**: Optimized dependency loading and execution speed
- **All CLIs**: Improved file I/O and parsing performance

### 📦 Package Management

#### Version Synchronization
- **All Packages**: Synchronized version numbers across Python (`pyproject.toml`), Go (`main.go`), Node.js (`package.json`), and VS Code extension (`package.json`)
- **Repository**: Consistent versioning strategy implemented for all components

### 🔮 Future Vision (Documented)

#### Component System Architecture
- **Documented**: Revolutionary component-based prompt architecture with inheritance
- **Documented**: Universal API/MCP compilation system design
- **Documented**: Generator ecosystem with modular `prompd-generators-*` packages
- **Documented**: Enterprise integration patterns and business model strategy

#### Strategic Positioning
- **Secured**: `github.com/prompd` for developer community building
- **Documented**: Complete domain portfolio strategy for education → enterprise pipeline
- **Planned**: Network effects strategy for ecosystem growth and value capture

### 🚨 Breaking Changes

None - this release maintains full backward compatibility with v0.2.x.

### 🔄 Migration Guide  

No migration steps required. All existing `.prompd` files and workflows continue to work without modification.

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