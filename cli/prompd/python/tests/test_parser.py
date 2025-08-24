"""Tests for prompd.parser module."""

import pytest
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
        """Test parsing a basic .prompd file."""
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
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.prompd', delete=False) as f:
            f.write(content)
            f.flush()
            
            prompd = self.parser.parse_file(Path(f.name))
            
            assert prompd.metadata.name == "test-prompt"
            assert prompd.metadata.description == "A test prompt"
            assert prompd.metadata.version == "1.0.0"
            assert len(prompd.metadata.parameters) == 1
            assert prompd.metadata.parameters[0].name == "topic"
            assert "user" in prompd.sections
            
            # Clean up
            Path(f.name).unlink()


def test_parse_missing_frontmatter():
    """Test parsing fails without frontmatter."""
    content = "Just some markdown content"
    
    parser = PrompdParser()
    with pytest.raises(ParseError, match="must start with YAML frontmatter"):
        parser.parse_content(content)


def test_parse_missing_name():
    """Test parsing fails without name field."""
    content = """---
description: Missing name
---
Content here
"""
    
    parser = PrompdParser()
    with pytest.raises(ParseError, match="Missing required field 'name'"):
        parser.parse_content(content)


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


def test_process_variables():
    """Test variable processing and normalization."""
    parser = PrompdParser()
    
    variables = [
        {"name": "test"},
        {"name": "with_type", "type": "integer"},
        {"name": "with_all", "type": "string", "required": True, "default": "value", "pattern": ".*"}
    ]
    
    processed = parser._process_variables(variables)
    
    assert processed[0]["type"] == "string"  # Default type
    assert processed[0]["required"] is False  # Default required
    assert processed[1]["type"] == "integer"
    assert processed[2]["required"] is True
    assert processed[2]["pattern"] == ".*"