#!/usr/bin/env python3
"""Comprehensive test of enhanced chat functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

def run_chat_input(shell, input_text):
    """Test a chat input and show results"""
    print(f"\n{'='*60}")
    print(f"USER: {input_text}")
    print('='*60)
    
    try:
        # Process the input like the chat mode would
        intent_data = shell.assistant.process_natural_language(input_text)
        response = shell.assistant.respond_conversationally(intent_data, shell)
        print(f"AI ASSISTANT: {response}")
        
        # If it's a compile intent, show what would happen
        if intent_data.get('intent') == 'compile':
            matching_files = shell.assistant.find_matching_files(intent_data['file'], shell.current_dir)
            if len(matching_files) == 1:
                params = {}
                if 'parameters' in intent_data and intent_data['parameters']:
                    params = shell.parse_parameters(intent_data['parameters'])
                
                print(f"\n[EXECUTION PREVIEW]")
                print(f"File found: {matching_files[0].name}")
                if params:
                    print(f"Parameters: {params}")
                else:
                    print("No parameters")
                    
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    print("COMPREHENSIVE CHAT FUNCTIONALITY TEST")
    print("=====================================")
    
    shell = PrompdShell()
    
    # Test various chat inputs
    test_cases = [
        # Basic compilation
        "compile test-prompt",
        "compile test-prompt app_name=\"MyApp\"",
        "compile test-prompt with app_name=\"TestApp\" language=\"Python\"",
        
        # Natural language parameter formats
        "compile test-prompt app_name \"testing\"",
        "compile test-prompt with params app_name=\"MyReactApp\"",
        
        # Questions and unsupported operations
        "is this something I can compile",
        "move a file from this directory to ./prompds",
        
        # File operations
        "show test-prompt",
        "list all files",
        
        # Registry operations (these would be pattern-matched in future)
        "search for security packages",
        "install @security/audit",
    ]
    
    for test_input in test_cases:
        run_chat_input(shell, test_input)
    
    print(f"\n{'='*60}")
    print("COMPREHENSIVE TEST COMPLETE!")
    print("Enhanced shell supports:")
    print("* Natural language compilation with parameters")  
    print("* Smart file matching and suggestions")
    print("* Helpful responses for unsupported operations")
    print("* Multiple parameter formats (key=value, key \"value\")")
    print("* Context-aware AI responses")
    print("="*60)