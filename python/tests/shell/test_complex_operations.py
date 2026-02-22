#!/usr/bin/env python3
"""Test complex file operations"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Complex File Operations")
    print("="*50)
    
    shell = PrompdShell()
    
    print("Current directory contents:")
    pdpkg_files = list(shell.current_dir.glob("*.pdpkg"))
    for f in pdpkg_files:
        print(f"  {f.name}")
    print(f"Found {len(pdpkg_files)} .pdpkg files")
    
    print("\nStep 1: Request complex operation")
    print("-"*50)
    shell.handle_chat_input("make a folder called packages and move all the *.pdpkg files into the new folder")
    
    print("\nStep 2: Confirm the operation")
    print("-"*50) 
    shell.handle_chat_input("yes, mkdir and move to packages")
    
    # Check results
    packages_dir = shell.current_dir / "packages" 
    if packages_dir.exists():
        moved_files = list(packages_dir.glob("*.pdpkg"))
        print(f"\nResult: Found {len(moved_files)} files in packages/ folder")
        for f in moved_files:
            print(f"  {f.name}")
    else:
        print("\nResult: packages/ folder not found")
    
    print("\nComplex operations test complete!")