"""Tests for prompd.validator module."""

import pytest
from pathlib import Path
import tempfile
from prompd.validator import PrompDValidator
from prompd.exceptions import ValidationError


class TestPrompDValidator:
    """Test PrompDValidator functionality."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.validator = PrompDValidator()
    
    def test_validate_version_format(self):
        """Test semantic version validation."""
        # Valid versions
        assert len(self.validator._validate_version("1.0.0")) == 0
        assert len(self.validator._validate_version("2.1.3")) == 0
        
        # Invalid versions
        issues = self.validator._validate_version("1.0")
        assert any("semantic versioning format" in issue["message"] for issue in issues)
        
        issues = self.validator._validate_version("v1.0.0")
        assert any("semantic versioning format" in issue["message"] for issue in issues)
    
    def test_suggest_version_bump(self):
        """Test version bump suggestions."""
        suggestion = self.validator.suggest_version_bump("1.0.0", "Added new feature")
        
        assert suggestion["recommended"] == "minor"
        assert suggestion["suggestions"]["patch"] == "1.0.1"
        assert suggestion["suggestions"]["minor"] == "1.1.0"
        assert suggestion["suggestions"]["major"] == "2.0.0"
        
        # Test breaking change detection
        breaking_suggestion = self.validator.suggest_version_bump("1.0.0", "Breaking change: removed API")
        assert breaking_suggestion["recommended"] == "major"


def test_validate_parameter_types():
    """Test validation of parameter types."""
    validator = PrompDValidator()
    
    metadata = {
        "name": "test",
        "variables": [
            {"name": "int_param", "type": "integer"},
            {"name": "float_param", "type": "float"},
            {"name": "bool_param", "type": "boolean"},
            {"name": "str_param", "type": "string"}
        ]
    }
    
    # Valid types should pass
    validator.validate_parameters(metadata, {
        "int_param": "42",
        "float_param": "3.14",
        "bool_param": "true",
        "str_param": "hello"
    })
    
    # Invalid integer should fail
    with pytest.raises(ValidationError, match="must be an integer"):
        validator.validate_parameters(metadata, {"int_param": "not_a_number"})


def test_validate_parameter_range():
    """Test validation of numeric ranges."""
    validator = PrompDValidator()
    
    metadata = {
        "name": "test",
        "variables": [
            {"name": "score", "type": "integer", "min": 0, "max": 100}
        ]
    }
    
    # Within range should pass
    validator.validate_parameters(metadata, {"score": "50"})
    
    # Below minimum should fail
    with pytest.raises(ValidationError, match="below minimum"):
        validator.validate_parameters(metadata, {"score": "-1"})
    
    # Above maximum should fail
    with pytest.raises(ValidationError, match="above maximum"):
        validator.validate_parameters(metadata, {"score": "101"})


def test_validate_parameter_pattern():
    """Test validation of string patterns."""
    validator = PrompDValidator()
    
    metadata = {
        "name": "test",
        "variables": [
            {"name": "email", "type": "string", "pattern": r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"}
        ]
    }
    
    # Valid email should pass
    validator.validate_parameters(metadata, {"email": "test@example.com"})
    
    # Invalid email should fail
    with pytest.raises(ValidationError, match="does not match required pattern"):
        validator.validate_parameters(metadata, {"email": "not_an_email"})


def test_validate_metadata():
    """Test validation of PMD metadata."""
    validator = PrompDValidator()
    
    # Valid metadata
    valid_metadata = {
        "name": "test-prompt",
        "description": "A test prompt",
        "version": "1.0.0"
    }
    issues = validator._validate_metadata(valid_metadata)
    assert len(issues) == 0
    
    # Invalid name format
    invalid_name = {"name": "Test_Prompt"}
    issues = validator._validate_metadata(invalid_name)
    assert any("kebab-case" in issue["message"] for issue in issues)
    
    # Invalid version format
    invalid_version = {"name": "test", "version": "1.0"}
    issues = validator._validate_metadata(invalid_version)
    assert any("semantic versioning" in issue["message"] for issue in issues)