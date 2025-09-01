#!/usr/bin/env python3
"""Test actual chat execution flow"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Actual Chat Execution Flow")
    print("="*50)
    
    shell = PrompdShell()
    
    # Make sure we have the test file
    test_file = shell.current_dir / "test-prompt.prompd"
    if not test_file.exists():
        print(f"Creating test file: {test_file}")
        test_file.write_text("""---
id: test-prompt
name: Test Prompt
---
This is a test.""")
    
    print("\nStep 1: Request file move through chat handler")
    print("-"*50)
    shell.handle_chat_input("move test-prompt.prompd to prompts")
    
    print("\nStep 2: Confirm the move")
    print("-"*50) 
    shell.handle_chat_input("yes, move test-prompt.prompd")
    
    # Check if file was moved
    moved_file = shell.current_dir / "prompts" / "test-prompt.prompd"
    if moved_file.exists():
        print(f"\nSUCCESS: File moved to {moved_file}")
    else:
        print(f"\nFile not found at {moved_file}")
    
    print("\nChat execution test complete!")