#!/usr/bin/env python3
"""Simple test runner for prompd package."""

import sys
from pathlib import Path
from prompd.models import ParameterDefinition, ParameterType, PrompdMetadata
from prompd.validator import PrompDValidator
from prompd.parser import PrompdParser

def test_models():
    """Test basic models functionality."""
    print("Testing models...")
    
    # Test parameter definition
    param = ParameterDefinition(
        name="test_param",
        type=ParameterType.STRING,
        description="A test parameter"
    )
    assert param.name == "test_param"
    assert param.type == ParameterType.STRING
    assert not param.required
    
    # Test metadata
    metadata = PrompdMetadata(
        name="test-prompt",
        description="A test prompt",
        version="1.0.0",
        parameters=[param]
    )
    assert metadata.name == "test-prompt"
    assert len(metadata.parameters) == 1
    
    print("OK Models tests passed")


def test_validator():
    """Test basic validator functionality."""
    print("Testing validator...")
    
    validator = PrompDValidator()
    
    # Test version validation
    valid_issues = validator._validate_version("1.2.3")
    assert len(valid_issues) == 0
    
    invalid_issues = validator._validate_version("1.2")
    assert len(invalid_issues) > 0
    
    # Test version bump suggestions
    suggestion = validator.suggest_version_bump("1.0.0", "Added new feature")
    assert suggestion["recommended"] == "minor"
    assert suggestion["suggestions"]["minor"] == "1.1.0"
    
    print("OK Validator tests passed")


def test_parser():
    """Test basic parser functionality."""
    print("Testing parser...")
    
    parser = PrompdParser()
    
    # Test variable extraction
    variables = parser.extract_variables("Hello {name}, discuss {topic}")
    assert "name" in variables
    assert "topic" in variables
    assert len(variables) == 2
    
    print("OK Parser tests passed")


def main():
    """Run all tests."""
    print("Running prompd tests...")
    
    try:
        test_models()
        test_validator() 
        test_parser()
        
        print("\nSUCCESS: All core tests passed!")
        
        # Check if shell tests are available
        shell_tests_path = Path(__file__).parent / "tests" / "shell" / "run_all_tests.py"
        if shell_tests_path.exists():
            print("\n" + "="*60)
            print("Enhanced Shell Tests are available at:")
            print("  python tests/shell/run_all_tests.py")
            print("  (Run separately for comprehensive shell testing)")
            print("="*60)
        
        return 0
        
    except Exception as e:
        print(f"\nFAILED: Test failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())