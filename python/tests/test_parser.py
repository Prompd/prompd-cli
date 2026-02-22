"""Tests for prompd.parser module."""

import pytest
import re
from pathlib import Path
import tempfile
from prompd.parser import PrompdParser
from prompd.exceptions import ParseError


class TestPrompdParser:
    """Test PrompdParser functionality."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.parser = PrompdParser()
    
    def test_parse_basic_file(self):
        """Test parsing a basic .prmd file."""
        content = """---
name: test-prompt
description: A test prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# User

Please discuss: {topic}
"""
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False) as f:
            f.write(content)
            f.flush()
            temp_file_path = Path(f.name)
            
        # Parse after closing the file
        prompd = self.parser.parse_file(temp_file_path)
        
        assert prompd.metadata.name == "test-prompt"
        assert prompd.metadata.description == "A test prompt"
        assert prompd.metadata.version == "1.0.0"
        assert len(prompd.metadata.parameters) == 1
        assert prompd.metadata.parameters[0].name == "topic"
        assert "user" in prompd.sections
        
        # Clean up
        temp_file_path.unlink()


def test_parse_missing_frontmatter():
    """Test parsing fails without frontmatter."""
    content = "Just some markdown content"
    
    parser = PrompdParser()
    with pytest.raises(ParseError, match="must start with YAML frontmatter"):
        parser.parse_content(content)


def test_parse_missing_name_allowed():
    """Parser should allow missing 'name' (friendly display), no exception."""
    content = """---
description: Missing name but valid structure
version: 1.0.0
---
Content here
"""

    parser = PrompdParser()
    prompd = parser.parse_content(content)
    assert prompd.metadata.name is None
    # ID is also optional at parse time; enforced by validator later
    assert prompd.metadata.id is None


def test_extract_variables():
    """Test extracting variable references from content."""
    parser = PrompdParser()
    
    content = """
    Simple variable: {name}
    Nested variable: {inputs.api_key}
    Conditional: {%- if mode == "auto" %}
    Multiple: {count} items for {topic}
    """
    
    variables = parser.extract_variables(content)
    
    assert "name" in variables
    assert "api_key" in variables
    assert "mode" in variables
    assert "count" in variables
    assert "topic" in variables


def test_parameter_defaults():
    """Test parameter defaults through Pydantic models."""
    from prompd.models import ParameterDefinition
    
    # Test default values
    param = ParameterDefinition(name="test")
    assert param.type == "string"  # Default type
    assert param.required is False  # Default required
    
    # Test explicit values
    param_with_type = ParameterDefinition(name="with_type", type="integer")
    assert param_with_type.type == "integer"
    
    # Test all fields
    param_full = ParameterDefinition(
        name="with_all", 
        type="string", 
        required=True, 
        default="value", 
        pattern=".*"
    )
    assert param_full.required is True
    assert param_full.pattern == ".*"
    assert param_full.default == "value"
