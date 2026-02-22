#!/usr/bin/env python3
"""Test script to demonstrate interactive mode"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import start_prompd_shell

if __name__ == "__main__":
    print("Testing Prompd Enhanced Shell with Conversational AI...")
    start_prompd_shell()