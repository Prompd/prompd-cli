#!/usr/bin/env python3
"""Test list command with PWD display"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing LIST/LS Command with PWD Display")
    print("=" * 50)
    
    shell = PrompdShell()
    
    # Test list command
    print("\n[TEST 1] Direct 'list' command:")
    print("chat> list")
    print("-" * 30)
    shell.interactive_list()
    
    # Test ls command (which now works directly)
    print("\n\n[TEST 2] Direct 'ls' command via chat:")
    print("chat> ls") 
    print("-" * 30)
    shell.handle_chat_input_enhanced("ls")
    
    # Test in different directory
    print("\n\n[TEST 3] Change directory and list:")
    print("chat> cd prompts")
    print("-" * 30)
    shell.interactive_cd("prompts")
    
    print("\nchat> list")
    print("-" * 30)
    shell.interactive_list()
    
    print("\n" + "=" * 50)
    print("PWD Display Test Complete!")
    print("✅ Current directory should now appear at the end of list output")
    print("✅ This makes navigation much clearer")
    print("=" * 50)