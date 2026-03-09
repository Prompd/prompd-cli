# Prompd CLI Distribution Strategy

This document outlines the distribution strategy for the Prompd CLI, keeping the stable Python version separate from the experimental Go implementation.

## Repository Structure

```
./
├── cli/prompd/                 # Development implementations
│   ├── python/                # Stable, feature-rich Python CLI
│   └── go/                    # Experimental, runtime-free Go CLI
├── cmd/prompd/main.go         # Public entry point (redirects to implementations)
├── go.mod                     # Public module (stable reference)
├── .github/workflows/         # Release automation
├── install.sh / install.ps1   # Installation scripts
└── dist/                      # Build outputs (ignored by git)
```

## Distribution Channels

### 1. GitHub Releases (Primary)
**Status**: ✅ Automated via GitHub Actions

- Cross-platform binaries (Linux, macOS, Windows)
- Automatic builds on version tags
- Direct download links
- Release notes generation

**Usage**:
```bash
# Latest release download
curl -sSL https://github.com/prompd/prompd-cli/raw/main/install.sh | bash

# Windows PowerShell
iwr https://github.com/prompd/prompd-cli/raw/main/install.ps1 | iex
```

### 2. Go Module Registry
**Status**: ✅ Ready

Users can install directly from source:
```bash
go install github.com/prompd/prompd-cli/go/cmd/prompd@latest
```

### 3. Package Managers (Future)

#### Homebrew (macOS/Linux)
```bash
brew install prompd
```

#### Scoop (Windows)
```bash
scoop install prompd
```

#### Chocolatey (Windows)  
```bash
choco install prompd
```

#### Snap (Linux)
```bash
snap install prompd
```

## Version Strategy

### Python CLI (Stable)
- **Location**: `cli/prompd/python/`
- **Version**: `0.2.x` (semantic versioning)
- **Target**: Feature-complete, stable, development environments
- **Installation**: `cd cli/prompd/python && pip install -e .`

### Go CLI (Experimental → Stable)
- **Location**: `cli/prompd/go/`
- **Version**: `1.0.x` (when ready for production)
- **Target**: Production, CI/CD, runtime-free environments
- **Installation**: Binary releases, `go install`

### Public Entry Point
- **Location**: `cmd/prompd/main.go`
- **Purpose**: Redirect users to appropriate implementation
- **Go Module**: `github.com/prompd/prompd-cli`

## Release Process

### 1. Development
- Work in `cli/prompd/go/` for Go CLI improvements
- Work in `cli/prompd/python/` for Python CLI features

### 2. Testing
- Build and test both implementations
- Validate feature parity
- Run integration tests

### 3. Tagging & Release
```bash
# Create version tag
git tag v1.0.0
git push origin v1.0.0

# GitHub Actions automatically:
# 1. Builds cross-platform binaries
# 2. Creates GitHub release
# 3. Uploads binaries and archives
```

### 4. Distribution Updates
- Update package manager configs (Homebrew, Scoop, etc.)
- Update Docker images
- Announce on relevant channels

## Installation Methods

### Quick Install (Recommended)
```bash
# Linux/macOS
curl -sSL https://github.com/prompd/prompd-cli/raw/main/install.sh | bash

# Windows (PowerShell)
iwr https://github.com/prompd/prompd-cli/raw/main/install.ps1 | iex
```

### From Source
```bash
# Go CLI
cd cli/prompd/go && go build -o prompd ./cmd/prompd

# Python CLI  
cd cli/prompd/python && pip install -e .
```

### Package Managers (When Available)
```bash
brew install prompd          # macOS/Linux
scoop install prompd         # Windows
choco install prompd         # Windows
snap install prompd          # Linux
```

## Benefits of This Strategy

1. **Separation of Concerns**: Stable Python CLI vs experimental Go CLI
2. **User Choice**: Runtime-dependent vs runtime-free options
3. **Automated Releases**: Zero-touch release process
4. **Multiple Channels**: GitHub, Go modules, package managers
5. **Cross-Platform**: Consistent experience across OS platforms
6. **Easy Migration**: When Go CLI is stable, can deprecate Python version

## Migration Path

1. **Phase 1** (Current): Both implementations coexist
2. **Phase 2** (Go CLI stable): Recommend Go CLI for new users
3. **Phase 3** (Future): Deprecate Python CLI, Go CLI becomes primary
4. **Phase 4** (Future): Move Go CLI to root, archive Python version