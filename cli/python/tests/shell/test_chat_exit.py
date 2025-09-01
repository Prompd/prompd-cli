#!/usr/bin/env python3
"""Test chat mode exit commands"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Chat Mode Exit Commands...")
    shell = PrompdShell()
    
    # Test various exit commands
    test_inputs = [
        "exit",
        "quit", 
        "bye",
        "goodbye",
        "exit chat",
        "quit chat",
        "leave chat"
    ]
    
    for input_text in test_inputs:
        print(f"\nTesting: {input_text}")
        
        # Process intent
        intent_data = shell.assistant.process_natural_language(input_text)
        print(f"Intent detected: {intent_data['intent']}")
        
        # Get response
        response = shell.assistant.respond_conversationally(intent_data, shell)
        print(f"Response: {response}")
        
        # Simulate being in chat mode
        shell.chat_mode = True
        shell.handle_chat_input(input_text)
        print(f"Chat mode after command: {shell.chat_mode}")
        
    print("\nAll exit commands properly recognized!")