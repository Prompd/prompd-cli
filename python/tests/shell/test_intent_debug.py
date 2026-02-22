#!/usr/bin/env python3
"""Debug intent detection"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import ConversationalAssistant
from rich.console import Console

if __name__ == "__main__":
    print("Debugging Intent Detection")
    print("="*40)
    
    console = Console()
    assistant = ConversationalAssistant(console)
    
    test_inputs = [
        "move test-prompt.prmd to prompts",
        "can you move test-prompt.prmd to prompts", 
        "yes, move test-prompt.prmd",
        "tell me a joke"  # This should be unclear
    ]
    
    for input_text in test_inputs:
        print(f"\nInput: {input_text}")
        intent_data = assistant.process_natural_language(input_text)
        print(f"Intent: {intent_data['intent']}")
        if 'raw_input' in intent_data:
            print(f"Raw input: {intent_data['raw_input']}")
        print("-"*40)