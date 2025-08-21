# Contributing to Prompd

Thank you for your interest in contributing to Prompd! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions.

## How to Contribute

### Reporting Issues

1. Check if the issue already exists
2. Include a clear description
3. Provide steps to reproduce
4. Include version information (`prompd --version`)
5. Add relevant .prompd files if applicable

### Suggesting Features

1. Open a discussion first for major features
2. Explain the use case
3. Provide examples if possible

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`python run_tests.py`)
6. Commit with clear messages
7. Push to your fork
8. Open a Pull Request

## Development Setup

### Prerequisites

- Python 3.8+
- Git
- Node.js 16+ (for VS Code extension)

### Local Development

```bash
# Clone the repository
git clone https://github.com/Logikbug/prompt-markdown.git
cd prompt-markdown

# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest tests/

# Quick test
python run_tests.py
```

### Code Style

- Follow PEP 8 for Python code
- Use type hints where appropriate
- Add docstrings to functions and classes
- Keep line length under 100 characters

### Testing

- Write tests for new features
- Ensure existing tests pass
- Add integration tests for CLI commands
- Test with multiple Python versions if possible

## Project Structure

```
prompt-markdown/
├── prompd/           # Main package
│   ├── cli.py       # CLI commands
│   ├── models.py    # Data models
│   ├── parser.py    # File parser
│   ├── validator.py # Validation logic
│   ├── executor.py  # Execution engine
│   └── providers/   # LLM providers
├── tests/           # Test suite
├── examples/        # Example files
├── docs/            # Documentation
└── vscode-extension/ # VS Code extension
```

## Adding a New Provider

1. Create provider file in `prompd/providers/`
2. Inherit from `BaseProvider`
3. Implement required methods
4. Add to provider registry
5. Add tests
6. Update documentation

Example:
```python
from prompd.providers.base import BaseProvider

class MyProvider(BaseProvider):
    name = "myprovider"
    supported_models = ["model1", "model2"]
    
    async def execute(self, request):
        # Implementation
        pass
```

## Documentation

- Update relevant docs when adding features
- Follow existing documentation style
- Include examples
- Update CLI reference if adding commands

## Release Process

1. Update version in `pyproject.toml`
2. Update CHANGELOG.md
3. Create git tag
4. Push to GitHub
5. GitHub Actions will handle the rest

## Questions?

- Open an issue for questions
- Join discussions on GitHub
- Check existing documentation

Thank you for contributing!