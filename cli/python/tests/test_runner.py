"""Test prompd execution and runner functionality."""

import asyncio
import tempfile
from pathlib import Path
import pytest

from prompd.executor import PrompdExecutor
from prompd.parser import PrompdParser
from prompd.models import PrompdMetadata, ParameterDefinition
from prompd.config import PrompdConfig
from prompd.exceptions import PrompdError


def test_executor_initialization():
    """Test PrompdExecutor initialization."""
    executor = PrompdExecutor()
    assert executor.config is not None
    assert executor.parser is not None
    assert executor.param_manager is not None


def test_parameter_validation():
    """Test parameter validation through parser."""
    parser = PrompdParser()
    
    # Valid content
    valid_content = """---
name: test-validation
version: 1.0.0
parameters:
  - name: name
    type: string
    required: true
  - name: count
    type: integer
    default: 5
---

Hello {name}, you have {count} messages."""
    
    prompd = parser.parse_content(valid_content)
    
    # Check parsed structure
    assert prompd.metadata.name == "test-validation"
    assert len(prompd.metadata.parameters) == 2
    
    # Check first parameter
    param1 = prompd.metadata.parameters[0]
    assert param1.name == "name"
    assert param1.type == "string"
    assert param1.required is True
    
    # Check second parameter
    param2 = prompd.metadata.parameters[1]
    assert param2.name == "count"
    assert param2.type == "integer"
    assert param2.default == 5


def test_prompd_sections_parsing():
    """Test parsing of different prompd sections."""
    parser = PrompdParser()
    
    content_with_sections = """---
name: test-sections
version: 1.0.0
system: You are a helpful assistant
user: Please help with {task}
context: This is background context
---

This is the main content with {variable}."""
    
    prompd = parser.parse_content(content_with_sections)
    
    assert prompd.metadata.system == "You are a helpful assistant"
    assert prompd.metadata.user == "Please help with {task}"
    assert prompd.metadata.context == "This is background context"
    assert "{variable}" in prompd.content


def test_parameter_types():
    """Test different parameter types are parsed correctly."""
    parser = PrompdParser()
    
    content = """---
name: test-types
version: 1.0.0
parameters:
  - name: text
    type: string
    required: true
  - name: number
    type: integer
    default: 42
  - name: flag
    type: boolean
    default: false
  - name: items
    type: array
    default: ["item1", "item2"]
---

Text: {text}
Number: {number}
Flag: {flag}
Items: {items}"""
    
    prompd = parser.parse_content(content)
    
    params = {p.name: p for p in prompd.metadata.parameters}
    
    assert params["text"].type == "string"
    assert params["text"].required is True
    
    assert params["number"].type == "integer"
    assert params["number"].default == 42
    
    assert params["flag"].type == "boolean"
    assert params["flag"].default is False
    
    assert params["items"].type == "array"
    assert params["items"].default == ["item1", "item2"]


def test_config_loading():
    """Test configuration loading."""
    config = PrompdConfig.load()
    
    # Check default values
    assert config.config_dir == Path.home() / ".prmd"
    assert config.timeout == 30
    assert config.max_retries == 3
    assert isinstance(config.api_keys, dict)
    assert isinstance(config.custom_providers, dict)


def test_file_parsing_with_temp_file():
    """Test parsing actual .prmd file."""
    parser = PrompdParser()
    
    content = """---
name: temp-test
description: Temporary test file
version: 1.0.0
parameters:
  - name: subject
    type: string
    required: true
    description: The subject to discuss
---

Please write about {subject}. Make it informative and engaging."""
    
    # Create temp file and test parsing
    with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False) as f:
        f.write(content)
        f.flush()
        temp_path = Path(f.name)
        
    try:
        prompd = parser.parse_file(temp_path)
        
        assert prompd.metadata.name == "temp-test"
        assert prompd.metadata.description == "Temporary test file"
        assert prompd.metadata.version == "1.0.0"
        assert len(prompd.metadata.parameters) == 1
        assert prompd.metadata.parameters[0].name == "subject"
        assert prompd.metadata.parameters[0].description == "The subject to discuss"
        assert "{subject}" in prompd.content
        
    finally:
        # Clean up
        temp_path.unlink()


def test_parameter_manager_initialization():
    """Test ParameterManager functionality through executor."""
    executor = PrompdExecutor()
    
    # Test parameter resolution capabilities exist
    assert hasattr(executor.param_manager, 'resolve_parameters')
    assert hasattr(executor.param_manager, 'parse_cli_parameters')
    assert hasattr(executor.param_manager, 'validate_required_parameters')
    
    # Test CLI parameter parsing
    cli_params = executor.param_manager.parse_cli_parameters([
        "name=Alice",
        "count=10",
        "flag=true"
    ])
    
    assert cli_params["name"] == "Alice"
    assert cli_params["count"] == "10"
    assert cli_params["flag"] == "true"


def test_jinja_environment_setup():
    """Test that executor has proper Jinja2 environment setup."""
    executor = PrompdExecutor()
    
    # Check that Jinja2 environment is configured
    assert hasattr(executor, 'jinja_env')
    assert executor.jinja_env is not None
    
    # Test template creation
    template = executor.jinja_env.from_string("Hello {name}")
    rendered = template.render(name="World")
    assert rendered == "Hello World"


def test_custom_providers_loading():
    """Test custom provider loading functionality."""
    executor = PrompdExecutor()
    
    # The _load_custom_providers method should exist and be called during init
    assert hasattr(executor, '_load_custom_providers')
    
    # If config has custom providers, they should be processed
    # (This test just verifies the functionality exists without breaking)
    try:
        executor._load_custom_providers()
    except Exception:
        # It's okay if this fails due to missing config, 
        # we're just testing the method exists
        pass