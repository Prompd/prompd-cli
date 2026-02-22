#!/usr/bin/env python3
"""Test improved parameter parsing"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Improved Parameter Parsing...")
    shell = PrompdShell()
    
    # Test various parameter formats
    test_inputs = [
        'compile test-prompt app_name "testing"',
        'compile test-prompt with params app_name "testing"',
        'compile test-prompt app_name=testing',
        'is this something I can compile',
        'move a file from this directory',
        'compile test-prompt with app_name="MyApp" language="Python"'
    ]
    
    for input_text in test_inputs:
        print(f"\n=== Testing: {input_text} ===")
        
        # Test intent parsing
        intent_data = shell.assistant.process_natural_language(input_text)
        print(f"Intent: {intent_data}")
        
        # Test parameter parsing if it's a compile intent
        if intent_data.get('intent') == 'compile' and 'parameters' in intent_data:
            params = shell.parse_parameters(intent_data['parameters'])
            print(f"Parsed params: {params}")
        
        # Test conversational response
        response = shell.assistant.respond_conversationally(intent_data, shell)
        print(f"Response: {response}")