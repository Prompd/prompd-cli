# Prompd CLI Implementations

This directory contains multiple implementations of the Prompd CLI tool in different programming languages, each optimized for different use cases and deployment scenarios.

## Available Implementations

### Python CLI (`python/`)
**Full-featured implementation with rich ecosystem integration**

- **Use Case**: Development, scripting, full-featured command line usage
- **Features**: Rich terminal output, comprehensive LLM provider support, extensive validation
- **Installation**: `pip install prompd`
- **Dependencies**: Python 3.8+, various Python packages
- **Size**: ~50MB with dependencies
- **Best for**: Developers, data scientists, automation scripts

**Key Features:**
- Rich colored terminal output with progress indicators
- Comprehensive error messages and validation
- Full LLM provider ecosystem (OpenAI, Anthropic, Ollama, custom providers)
- Advanced configuration management
- Complete version control integration
- Extensive testing suite

### Go CLI (`go/`)
**Lightweight, zero-dependency implementation for distribution**

- **Use Case**: Prompd IDE integration, containerized environments, standalone distribution
- **Features**: Fast startup, minimal memory footprint, single binary deployment
- **Installation**: Download binary or `go install`
- **Dependencies**: None (statically compiled)
- **Size**: ~8MB single binary
- **Best for**: IDE integration, containers, embedded systems, air-gapped environments

**Key Features:**
- Zero external dependencies (except optional config files)
- Fast startup time (<10ms)
- Cross-platform single binary
- Full feature parity with Python version
- Identical command-line interface
- Same .prompd file compatibility

## Usage

Both implementations provide identical command-line interfaces:

```bash
# Validate a prompd file
prompd validate example.prompd

# List available prompts
prompd list examples/

# Execute a prompt with LLM
prompd execute example.prompd --provider openai --model gpt-4o

# Manage providers
prompd provider list
prompd provider add local-llm http://localhost:8080/v1 llama2

# Version management
prompd version bump example.prompd patch
prompd version history example.prompd
```

## Quick Start

### Go CLI (Recommended for production/IDE integration)
```bash
cd go/
go build -o prompd ./cmd/prompd
./prompd validate ../../examples/basic/example.prompd
```

### Python CLI (Recommended for development)
```bash
cd python/
pip install -e .
prompd validate ../../examples/basic/example.prompd
```

## Adding New CLI Implementations

When adding new CLI implementations, follow this structure:

```
cli/
├── language-name/           # New CLI implementation
│   ├── README.md           # Language-specific documentation
│   ├── src/                # Source code
│   ├── tests/              # Test suite
│   ├── build-scripts/      # Build automation
│   └── dist/               # Distribution artifacts
└── README.md               # This overview file
```

### Requirements for New Implementations

All CLI implementations must:

1. **Feature Parity**: Support all core commands (validate, list, show, execute, provider, git, version)
2. **File Compatibility**: Parse identical .prompd file format
3. **Config Compatibility**: Read/write same configuration format
4. **Command Interface**: Provide identical command-line interface
5. **Exit Codes**: Use consistent exit codes for automation
6. **Error Handling**: Provide clear, actionable error messages

### Suggested Future Implementations

- **`dotnet/`** - C# implementation for Windows ecosystems
- **`npm/`** - Node.js implementation for web developers
- **`rust/`** - Ultra-fast implementation for performance-critical applications
- **`java/`** - JVM implementation for enterprise environments

## Build Cross-Platform Binaries

From the repository root:
```bash
./build.sh    # Linux/macOS
build.bat     # Windows
```

Binaries will be in `dist/` folder.

## Version Synchronization

All CLI implementations are kept in sync at the same version number to ensure feature parity and compatibility. Current version: **0.2.3**