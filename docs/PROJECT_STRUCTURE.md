# Project Structure

This document describes the organization of the Prompd project.

## 📁 Directory Layout

```
prompt-markdown/
├── 📄 README.md                    # Main project overview
├── 📄 LICENSE                      # MIT license
├── 📄 pyproject.toml               # Python package configuration
├── 📄 CHANGELOG.md                 # Version history
├── 📄 CONTRIBUTING.md              # Contribution guidelines
├── 📄 .gitignore                   # Git ignore rules
├── 📄 .gitattributes               # Git attributes
├── 📄 run_tests.py                 # Quick test runner
├── 📄 CLAUDE.md                    # AI assistant context
├── 
├── 📂 prompd/                      # 🎯 Main Python package
│   ├── 📄 __init__.py             #   Package initialization
│   ├── 📄 cli.py                  #   CLI commands and interface
│   ├── 📄 models.py               #   Pydantic data models
│   ├── 📄 parser.py               #   .prompd file parser
│   ├── 📄 validator.py            #   Validation logic
│   ├── 📄 executor.py             #   Execution engine
│   ├── 📄 config.py               #   Configuration management
│   ├── 📄 exceptions.py           #   Custom exceptions
│   └── 📂 providers/              #   LLM provider implementations
│       ├── 📄 __init__.py        #     Provider registry
│       ├── 📄 base.py            #     Base provider class
│       ├── 📄 openai.py          #     OpenAI provider
│       ├── 📄 anthropic.py       #     Anthropic provider
│       └── 📄 ollama.py          #     Ollama provider
├── 
├── 📂 tests/                       # 🧪 Test suite
│   ├── 📄 __init__.py             #   Test package init
│   ├── 📄 test_models.py          #   Model tests
│   ├── 📄 test_parser.py          #   Parser tests
│   ├── 📄 test_validator.py       #   Validator tests
│   └── 📄 test_runner.py          #   Legacy test file
├── 
├── 📂 docs/                        # 📚 Documentation
│   ├── 📄 README.md               #   Documentation index
│   ├── 📄 FORMAT.md               #   File format specification
│   ├── 📄 CLI.md                  #   CLI reference guide
│   ├── 📄 PROJECT_STRUCTURE.md    #   This file
│   └── 📂 roadmap/                #   Future plans
│       ├── 📄 REGISTRY_ROADMAP.md #     Package registry vision
│       └── 📄 VSCODE_EXTENSION_ROADMAP.md # VS Code extension plans
├── 
├── 📂 examples/                    # 💡 Example .prompd files
│   ├── 📄 README.md               #   Example guide
│   ├── 📂 basic/                  #   Getting started examples
│   │   ├── 📄 example.prompd      #     Simple example
│   │   ├── 📄 test-prompt.prompd  #     Test case
│   │   ├── 📄 structured-example.prompd # Complete example
│   │   └── 📄 params.json         #     Parameter file
│   ├── 📂 features/               #   Feature demonstrations
│   │   ├── 📄 yaml-content.prompd #     YAML content example
│   │   ├── 📄 yaml-only.prompd    #     YAML-only prompt
│   │   └── 📄 markdown-features.prompd # Markdown examples
│   └── 📂 advanced/               #   Real-world use cases
│       └── 📄 fetch-ai-literacy-articles.prompd # Research prompt
├── 
└── 📂 vscode-extension/            # 🔧 VS Code Extension
    ├── 📄 package.json            #   Extension manifest
    ├── 📄 README.md               #   Extension documentation
    ├── 📄 tsconfig.json           #   TypeScript configuration
    ├── 📄 language-configuration.json # Language settings
    ├── 📂 src/                    #   TypeScript source
    │   └── 📄 extension.ts        #     Main extension code
    ├── 📂 syntaxes/               #   Syntax highlighting
    │   └── 📄 prompd.tmLanguage.json # TextMate grammar
    └── 📂 snippets/               #   Code snippets
        └── 📄 prompd.json         #     Snippet definitions
```

## 🎯 Core Components

### Python Package (`prompd/`)

The main CLI tool and library:

- **`cli.py`** - Click-based command line interface
- **`models.py`** - Pydantic models for type safety
- **`parser.py`** - Parses .prompd files into structured data
- **`validator.py`** - Validates syntax, semantics, and versions
- **`executor.py`** - Orchestrates prompt execution
- **`config.py`** - Manages configuration and parameters
- **`providers/`** - LLM provider implementations

### Documentation (`docs/`)

Complete project documentation:

- **`FORMAT.md`** - Authoritative .prompd format specification
- **`CLI.md`** - Complete CLI reference with examples
- **`roadmap/`** - Future plans and vision documents

### Examples (`examples/`)

Categorized example files:

- **`basic/`** - Simple examples for learning
- **`features/`** - Demonstrate specific capabilities
- **`advanced/`** - Real-world use cases

### VS Code Extension (`vscode-extension/`)

Full-featured IDE integration:

- Syntax highlighting with TextMate grammar
- IntelliSense and auto-completion
- Real-time validation and diagnostics
- Command integration
- Snippets and templates

## 📦 Build Artifacts

Generated during development/build:

```
prompt-markdown/
├── 📂 prompd.egg-info/     # Package metadata (pip install -e .)
├── 📂 __pycache__/         # Python bytecode cache
├── 📂 .pytest_cache/      # Pytest cache
├── 📂 vscode-extension/out/ # Compiled TypeScript
└── 📂 vscode-extension/node_modules/ # Node dependencies
```

These are ignored by git (see `.gitignore`).

## 🔧 Configuration Files

### Python Package
- **`pyproject.toml`** - Modern Python packaging (PEP 518)
- **`setup.py`** - Not used (pyproject.toml only)

### VS Code Extension
- **`package.json`** - Extension manifest and dependencies
- **`tsconfig.json`** - TypeScript compiler settings

### Development
- **`.gitignore`** - Git ignore patterns
- **`.gitattributes`** - Git file handling rules
- **`run_tests.py`** - Quick test runner (no pytest dependency)

## 🎨 Design Principles

### Directory Organization
- **Logical grouping** - Related files grouped together
- **Clear separation** - Code, docs, examples, tests separate
- **Flat when possible** - Avoid deep nesting
- **Discoverable** - README files guide users

### File Naming
- **kebab-case** for .prompd files (`code-reviewer.prompd`)
- **snake_case** for Python files (`test_models.py`)
- **PascalCase** for classes (`PrompdParser`)
- **UPPERCASE** for constants and special files (`README.md`)

### Documentation Structure
- **README files** in each major directory
- **Progressive disclosure** - overview → details
- **Examples included** in documentation
- **Cross-references** between related docs

## 🚀 Getting Started Paths

### For Users
1. Read main `README.md`
2. Try `examples/basic/`
3. Check `docs/CLI.md`
4. Install VS Code extension

### For Contributors
1. Read `CONTRIBUTING.md`
2. Study `docs/FORMAT.md`
3. Explore `prompd/` source code
4. Run tests with `run_tests.py`

### For Extension Developers
1. Check `vscode-extension/README.md`
2. Study existing providers in `prompd/providers/`
3. Follow patterns in `prompd/models.py`

## 📝 Maintenance

### Regular Tasks
- Update `CHANGELOG.md` for releases
- Keep examples up to date
- Validate all .prompd files in examples
- Update documentation for new features

### Quality Checks
```bash
# Validate all examples
find examples -name "*.prompd" -exec prompd validate {} \;

# Run test suite
python run_tests.py

# Check imports and structure
python -c "import prompd; print('✓ Package imports')"
```

This structure supports the project's goals of being approachable for users while maintaining clean architecture for contributors.