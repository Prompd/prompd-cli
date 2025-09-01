#!/usr/bin/env python3
"""Test confirmation-based file operations"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant
from rich.console import Console

if __name__ == "__main__":
    print("Testing Confirmation-Based File Operations")
    print("="*50)
    
    console = Console()
    assistant = ConversationalAssistant(console)
    
    # Step 1: Request file move
    print("\nStep 1: Request file move")
    print("-"*30)
    response1 = assistant.get_ai_response("move test-prompt.prompd to prompts")
    print(f"AI: {response1}")
    
    # Step 2: Confirm the move
    print("\nStep 2: Confirm the move")  
    print("-"*30)
    response2 = assistant.get_ai_response("yes, move test-prompt.prompd")
    print(f"AI: {response2}")
    
    print("\n" + "="*50)
    print("Confirmation test complete!")