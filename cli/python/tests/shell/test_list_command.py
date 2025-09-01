#!/usr/bin/env python3
"""Test the updated list command"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Updated List Command")
    print("="*50)
    
    shell = PrompdShell()
    
    print("Testing ls command:")
    print("-" * 30)
    shell.interactive_list()
    
    print("\n" + "="*50)
    print("List command test complete!")