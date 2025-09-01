#!/usr/bin/env python3
"""Test script to demonstrate chat feature"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant
from rich.console import Console

if __name__ == "__main__":
    print("Testing Prompd Chat Assistant...")
    console = Console()
    assistant = ConversationalAssistant(console)
    
    # Test natural language processing
    test_queries = [
        "compile my security prompt",
        "show me what's in that API template", 
        "help me create a new prompt",
        "list all the available packages",
        "what can you do?"
    ]
    
    for query in test_queries:
        print(f"\nUser: {query}")
        response = assistant.process_natural_language(query)
        print(f"AI: {response}")