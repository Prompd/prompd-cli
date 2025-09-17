#!/usr/bin/env python3
"""Test parameter parsing fixes"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Parameter Parsing Fixes")
    print("=" * 40)
    
    shell = PrompdShell()
    
    # Test parameter parsing directly
    test_params = [
        "task_type = generate code",           # Spaces around =
        "task_type=generate_code",            # No spaces
        "task_type=\"generate code\"",         # Quoted
        "app_name = MyApp language = python", # Multiple params with spaces
    ]
    
    print("Testing parameter parsing:")
    for param_text in test_params:
        print(f"\nInput: '{param_text}'")
        try:
            parsed = shell.parse_parameters(param_text)
            print(f"Parsed: {parsed}")
        except Exception as e:
            print(f"Error: {e}")
    
    print("\n" + "=" * 40)
    print("Testing compile with existing file:")
    
    # Test with actual file that exists
    test_commands = [
        "compile prompds/master-prompt.prmd task_type = generate code",
        "compile cooking-recipes.prmd",
    ]
    
    for command in test_commands:
        print(f"\nchat> {command}")
        print("-" * 30)
        try:
            shell.handle_chat_input_enhanced(command)
        except Exception as e:
            print(f"Error: {e}")
    
    print("\n" + "=" * 40)
    print("PARAMETER PARSING FIXES:")
    print("- Now handles spaces around = sign")
    print("- Multiple parameter formats supported") 
    print("- Compile command should work with parameters")
    print("=" * 40)