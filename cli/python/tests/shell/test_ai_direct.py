#!/usr/bin/env python3
"""Test AI directly with execute command"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.executor import PrompDExecutor
from prompd.config import PrompDConfig

if __name__ == "__main__":
    print("Testing Direct AI Execution...")
    
    try:
        # Get config
        config = PrompDConfig()
        providers = config.get_providers()
        print(f"Available providers: {list(providers.keys()) if providers else 'None'}")
        
        # Create executor
        executor = PrompDExecutor()
        
        # Test prompt
        test_prompt = """You are a helpful assistant. 
The user said: "tell me a joke about programming"
Please respond with a short programming joke."""
        
        # Try to execute with OpenAI
        print("\nTrying OpenAI provider...")
        result = executor.execute(
            prompt_content=test_prompt,
            provider="openai",
            model=None,
            parameters={},
            verbose=False
        )
        
        if result:
            print(f"Success! Response: {result}")
        else:
            print("No response received")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()