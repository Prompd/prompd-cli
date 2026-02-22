#!/usr/bin/env python3
"""Test prompt creation functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant, PrompdShell
from rich.console import Console

if __name__ == "__main__":
    print("Testing Prompt Creation Functionality")
    print("="*50)
    
    console = Console()
    assistant = ConversationalAssistant(console)
    shell = PrompdShell()
    
    # Test prompt creation request
    intent_data = {
        'intent': 'unclear',
        'raw_input': 'create a new prompd to generate livestock feeding schedules'
    }
    
    print("Step 1: Request prompt creation")
    print("-"*50)
    print(f"Input: {intent_data['raw_input']}")
    response = assistant.respond_conversationally(intent_data, shell)
    print(f"Response: {response}")
    
    print("\nStep 2: Confirm prompt creation")
    print("-"*50)
    confirm_intent_data = {
        'intent': 'unclear', 
        'raw_input': 'yes, create livestock-feeding-schedules.prmd'
    }
    
    print(f"Input: {confirm_intent_data['raw_input']}")
    confirm_response = assistant.respond_conversationally(confirm_intent_data, shell)
    print(f"Response: {confirm_response}")
    
    # Check if file was created
    created_file = shell.current_dir / "livestock-feeding-schedules.prmd"
    if created_file.exists():
        print(f"\nSUCCESS: File created at {created_file}")
        print("File contents preview:")
        print("-" * 30)
        content = created_file.read_text()
        print(content[:300] + "..." if len(content) > 300 else content)
    else:
        print(f"\nFile not found at {created_file}")
    
    print("\nPrompt creation test complete!")