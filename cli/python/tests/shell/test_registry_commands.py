#!/usr/bin/env python3
"""Test script for registry commands"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Registry Commands...")
    shell = PrompdShell()
    
    # Test registry commands
    commands = [
        "help",
        "search security",
        "install @security/audit",
        "publish",  # Should show available packages
        "login --token test123",
        "status"
    ]
    
    for command in commands:
        print(f"\n$ prompd> {command}")
        shell.execute_command(command)