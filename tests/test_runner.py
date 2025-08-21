"""Tests for PMD runner."""

import pytest
from pmd.runner import PMDRunner
from pmd.exceptions import PMDError


def test_run_simple_substitution():
    """Test simple variable substitution."""
    runner = PMDRunner()
    
    metadata = {
        "name": "test",
        "variables": [
            {"name": "name", "type": "string"},
            {"name": "count", "type": "integer", "default": 5}
        ]
    }
    
    content = "Hello {name}, you have {count} messages."
    
    # Test with all parameters provided
    result = runner._substitute_variables(
        content,
        runner._prepare_context(metadata, {"name": "Alice", "count": 10})
    )
    assert result == "Hello Alice, you have 10 messages."
    
    # Test with default value
    result = runner._substitute_variables(
        content,
        runner._prepare_context(metadata, {"name": "Bob", "count": 5})
    )
    assert result == "Hello Bob, you have 5 messages."


def test_run_conditional_logic():
    """Test conditional logic in templates."""
    runner = PMDRunner()
    
    metadata = {"name": "test"}
    content = """
{%- if mode == "auto" %}
Automatic mode enabled
{%- else %}
Manual mode enabled
{%- endif %}
"""
    
    # Test auto mode
    result = runner._substitute_variables(
        content.strip(),
        {"mode": "auto"}
    )
    assert "Automatic mode enabled" in result
    
    # Test manual mode
    result = runner._substitute_variables(
        content.strip(),
        {"mode": "manual"}
    )
    assert "Manual mode enabled" in result


def test_merge_parameters():
    """Test merging user parameters with defaults."""
    runner = PMDRunner()
    
    metadata = {
        "name": "test",
        "variables": [
            {"name": "with_default", "default": "default_value"},
            {"name": "without_default"},
            {"name": "override", "default": "original"}
        ]
    }
    
    user_params = {
        "without_default": "user_value",
        "override": "overridden",
        "extra": "extra_value"
    }
    
    merged = runner._merge_parameters(metadata, user_params)
    
    assert merged["with_default"] == "default_value"
    assert merged["without_default"] == "user_value"
    assert merged["override"] == "overridden"
    assert merged["extra"] == "extra_value"


def test_process_parameter_types():
    """Test processing different parameter types."""
    runner = PMDRunner()
    
    # Integer
    assert runner._process_parameter_value("42", {"type": "integer"}) == 42
    
    # Float
    assert runner._process_parameter_value("3.14", {"type": "float"}) == 3.14
    
    # Boolean
    assert runner._process_parameter_value("true", {"type": "boolean"}) is True
    assert runner._process_parameter_value("false", {"type": "boolean"}) is False
    
    # Array from string
    result = runner._process_parameter_value("a, b, c", {"type": "array"})
    assert result == ["a", "b", "c"]
    
    # Array from list
    result = runner._process_parameter_value(["x", "y"], {"type": "array"})
    assert result == ["x", "y"]


def test_prepare_context():
    """Test context preparation for substitution."""
    runner = PMDRunner()
    
    metadata = {
        "name": "test-prompt",
        "version": "1.0.0",
        "inputs": {
            "api_key": "secret",
            "endpoint": "https://api.example.com"
        }
    }
    
    parameters = {
        "user": "Alice",
        "count": 5
    }
    
    context = runner._prepare_context(metadata, parameters)
    
    assert context["user"] == "Alice"
    assert context["count"] == 5
    assert context["inputs"]["api_key"] == "secret"
    assert context["inputs"]["endpoint"] == "https://api.example.com"
    assert context["_metadata"]["name"] == "test-prompt"
    assert context["_metadata"]["version"] == "1.0.0"