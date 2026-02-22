#!/usr/bin/env python3
"""Test script to test full parameter flow"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Full Parameter Flow...")
    shell = PrompdShell()
    
    # Simulate chat input with parameters
    test_input = 'compile test-prompt.prmd for a React app app_name="MyReactApp"'
    print(f"\nSimulating chat input: {test_input}")
    
    shell.handle_chat_input(test_input)