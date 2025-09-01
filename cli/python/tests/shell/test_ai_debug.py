#!/usr/bin/env python3
"""Debug AI execution"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

if __name__ == "__main__":
    print("Debugging AI Execution...")
    
    try:
        from prompd.executor import PrompDExecutor
        from prompd.config import PrompDConfig
        
        # Create executor
        executor = PrompDExecutor()
        
        # Get available providers
        providers = executor.get_available_providers()
        print(f"Available providers: {providers}")
        
        # Check API keys
        config = PrompDConfig.load()
        for provider in providers:
            api_key = config.get_api_key(provider)
            print(f"{provider}: {'API key set' if api_key else 'No API key'}")
        
        # Try a simple execution
        print("\nTrying direct execution with OpenAI...")
        
        result = executor.execute(
            prompt_content="Tell me a short programming joke.",
            provider="openai",
            model="gpt-3.5-turbo",  # Explicitly set model
            parameters={},
            verbose=True  # Enable verbose to see what's happening
        )
        
        print(f"\nResult type: {type(result)}")
        print(f"Result: {result}")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()