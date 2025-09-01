#!/usr/bin/env python3
"""Test AI integration with providers"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell, ConversationalAssistant
from rich.console import Console

if __name__ == "__main__":
    print("Testing AI Integration with Providers...")
    print("="*60)
    
    console = Console()
    shell = PrompdShell()
    assistant = ConversationalAssistant(console)
    
    # First check if providers are available
    try:
        from prompd.providers import get_providers
        providers = get_providers()
        if providers:
            print(f"Providers found: {list(providers.keys())}")
        else:
            print("No providers configured")
    except Exception as e:
        print(f"Error checking providers: {e}")
    
    print("\n" + "="*60)
    
    # Test AI responses for unclear inputs
    test_queries = [
        "what's the weather like",
        "how do I create a new prompt file",
        "explain what prompd does",
        "tell me a joke",
        "help me understand compilation"
    ]
    
    for query in test_queries:
        print(f"\nUser: {query}")
        print("-"*40)
        
        # This should trigger AI for unclear inputs
        intent_data = assistant.process_natural_language(query)
        print(f"Intent: {intent_data['intent']}")
        
        if intent_data['intent'] == 'unclear':
            # Try to get AI response
            response = assistant.get_ai_response(query)
            print(f"AI Response: {response}")
        else:
            response = assistant.respond_conversationally(intent_data, shell)
            print(f"Pattern Response: {response}")
    
    print("\n" + "="*60)
    print("AI Integration Test Complete!")