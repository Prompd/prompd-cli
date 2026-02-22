#!/usr/bin/env python3
"""Final test of AI integration"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant
from rich.console import Console

if __name__ == "__main__":
    print("Testing AI Integration - Final Test")
    print("="*60)
    
    console = Console()
    assistant = ConversationalAssistant(console)
    
    # Test queries that should trigger AI
    test_queries = [
        "tell me a programming joke",
        "what is prompd used for",
        "explain compilation in simple terms"
    ]
    
    for query in test_queries:
        print(f"\nUser: {query}")
        print("-"*40)
        
        # Get AI response
        response = assistant.get_ai_response(query)
        print(f"AI: {response}")