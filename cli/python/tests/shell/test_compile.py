#!/usr/bin/env python3
"""Test script to test compile command"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Prompd Shell Compile Command...")
    shell = PrompdShell()
    
    # Test the compile command directly
    print("\nTesting compile command with test-prompt.prompd:")
    shell.execute_command("compile test-prompt.prompd")
    
    print("\nTesting compile command with ./test-prompt.prompd:")
    shell.execute_command("compile ./test-prompt.prompd")