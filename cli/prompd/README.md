# Prompd CLI Implementations

This directory contains different implementations of the Prompd CLI tool.

## Available Implementations

### Go Implementation (`./go/`)
- **Runtime-free**: Single binary with zero dependencies
- **Cross-platform**: Windows, Linux, macOS (Intel & Apple Silicon)
- **Fast**: Native performance
- **Portable**: Perfect for CI/CD, Docker, air-gapped systems
- **Size**: ~6-8MB standalone binary

**Best for**: Production deployments, CI/CD pipelines, systems without runtime dependencies

### Python Implementation (`./python/`)  
- **Feature-rich**: Full LLM integrations, git operations, advanced validation
- **Rich output**: Colorized terminal output with tables and panels
- **Extensible**: Easy to add new providers and features
- **Mature**: Complete implementation with all advanced features

**Best for**: Development environments, feature-rich workflows, when Python is already available

## Quick Start

### Go CLI (Recommended for production)
```bash
cd go/
go build -o prompd ./cmd/prompd
./prompd validate example.prompd
```

### Python CLI (Recommended for development)
```bash
cd python/
pip install -e .
prompd validate example.prompd
```

## Build Cross-Platform Binaries

From the root directory:
```bash
./build.sh    # Linux/macOS
build.bat     # Windows
```

Binaries will be in `../../../dist/` folder.