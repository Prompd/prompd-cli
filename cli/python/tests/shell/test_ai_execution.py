#!/usr/bin/env python3
"""Test AI execution capability"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant
from rich.console import Console

if __name__ == "__main__":
    print("Testing AI Execution Capability")
    print("="*50)
    
    console = Console()
    assistant = ConversationalAssistant(console)
    
    # Test file operation requests
    test_queries = [
        "can you move ./test-prompt.prompd to ./prompts",
        "move test-prompt.prompd to prompts",
        "please move ./test-prompt.prompd to ./prompts/"
    ]
    
    for query in test_queries:
        print(f"\nUser: {query}")
        print("-"*40)
        
        # This should now execute the file move
        response = assistant.get_ai_response(query)
        print(f"AI: {response}")
    
    print("\n" + "="*50)
    print("Execution test complete!")