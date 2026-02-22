#!/usr/bin/env python3
"""Test autocomplete functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

def test_readline_import():
    """Test if readline is available"""
    try:
        import readline
        print("[OK] readline module imported successfully")
        print(f"readline version: {getattr(readline, '__version__', 'unknown')}")
        return True
    except ImportError as e:
        print(f"[FAIL] readline import failed: {e}")
        print("This is common on Windows - readline is not included by default")
        return False

def test_shell_autocomplete_setup():
    """Test shell autocomplete setup"""
    from prompd.shell import PrompdShell
    
    shell = PrompdShell()
    print("Shell created successfully")
    
    # Try to setup autocompletion
    try:
        shell.setup_autocompletion()
        print("[OK] Autocomplete setup completed without errors")
    except Exception as e:
        print(f"[FAIL] Autocomplete setup failed: {e}")

if __name__ == "__main__":
    print("Testing Autocomplete Functionality")
    print("=" * 40)
    
    # Test readline availability
    readline_available = test_readline_import()
    print()
    
    # Test shell setup
    print("Testing shell autocomplete setup:")
    test_shell_autocomplete_setup()
    print()
    
    if not readline_available:
        print("FIX NEEDED:")
        print("Windows doesn't include readline by default.")
        print("Install pyreadline3 for Windows readline support:")
        print("  pip install pyreadline3")
        print()
        print("Alternative: Use prompt_toolkit for better Windows compatibility")