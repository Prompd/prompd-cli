#!/usr/bin/env python3
"""Test script to test parameter parsing"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Prompd Parameter Parsing...")
    shell = PrompdShell()
    
    # Test parameter parsing
    test_params = [
        'a React app app_name="MyReactApp"',
        'for React app',
        'with Node.js app_name="testing"',
        'app_name="TestApp" language="TypeScript"'
    ]
    
    for param_text in test_params:
        print(f"\nInput: {param_text}")
        params = shell.parse_parameters(param_text)
        print(f"Parsed: {params}")
    
    # Test the chat handler directly
    print("\nTesting chat input parsing:")
    test_inputs = [
        'compile test-prompt.prompd for a React app app_name="MyReactApp"',
        'compile test-prompt.prompd with app_name="testing" language="Python"'
    ]
    
    for input_text in test_inputs:
        print(f"\nInput: {input_text}")
        intent_data = shell.assistant.process_natural_language(input_text)
        print(f"Intent: {intent_data}")