#!/usr/bin/env python3
"""Test conversational response directly"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant, PrompdShell
from rich.console import Console

if __name__ == "__main__":
    print("Testing Direct Conversational Response")
    print("="*50)
    
    console = Console()
    assistant = ConversationalAssistant(console)
    shell = PrompdShell()
    
    # Create a test intent data for file operation
    intent_data = {
        'intent': 'unclear',
        'raw_input': 'move test-prompt.prmd to prompts'
    }
    
    print(f"Intent data: {intent_data}")
    
    # Call respond_conversationally directly
    response = assistant.respond_conversationally(intent_data, shell)
    print(f"Response: {response}")
    
    print("\n" + "="*50)
    
    # Test confirmation
    confirm_intent_data = {
        'intent': 'unclear', 
        'raw_input': 'yes, move test-prompt.prmd'
    }
    
    print(f"Confirm intent data: {confirm_intent_data}")
    confirm_response = assistant.respond_conversationally(confirm_intent_data, shell)
    print(f"Confirm response: {confirm_response}")