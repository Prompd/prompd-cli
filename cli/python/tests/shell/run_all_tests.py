#!/usr/bin/env python3
"""
Shell Test Runner
Runs all automated tests for the enhanced Prompd Shell
"""

import os
import sys
import subprocess
from pathlib import Path

def run_test_file(test_file):
    """Run a single test file and return success/failure"""
    try:
        print(f"\n{'='*60}")
        print(f"Running {test_file}")
        print('='*60)
        
        result = subprocess.run([sys.executable, test_file], 
                              capture_output=False, 
                              timeout=30)
        
        if result.returncode == 0:
            print(f"✓ {test_file} - PASSED")
            return True
        else:
            print(f"✗ {test_file} - FAILED (exit code: {result.returncode})")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"✗ {test_file} - TIMEOUT")
        return False
    except Exception as e:
        print(f"✗ {test_file} - ERROR: {e}")
        return False

def main():
    """Run all shell tests"""
    print("Enhanced Prompd Shell - Test Suite Runner")
    print("="*60)
    
    # Get the current directory (should be tests/shell)
    test_dir = Path(__file__).parent
    
    # Find all test files (excluding interactive ones)
    automated_tests = []
    interactive_tests = []
    
    for test_file in sorted(test_dir.glob("test_*.py")):
        # Skip interactive tests that require user input
        if any(keyword in test_file.name for keyword in ['live', 'interactive', 'enhanced_chat_interface']):
            interactive_tests.append(test_file)
        else:
            automated_tests.append(test_file)
    
    print(f"Found {len(automated_tests)} automated tests")
    print(f"Found {len(interactive_tests)} interactive tests")
    
    # Run automated tests
    if automated_tests:
        print(f"\nRunning {len(automated_tests)} automated tests...")
        
        passed = 0
        failed = 0
        
        for test_file in automated_tests:
            if run_test_file(test_file):
                passed += 1
            else:
                failed += 1
        
        print(f"\n{'='*60}")
        print("AUTOMATED TEST RESULTS:")
        print(f"✓ Passed: {passed}")
        print(f"✗ Failed: {failed}")
        print(f"Total: {passed + failed}")
        print('='*60)
        
        if failed > 0:
            print(f"\n⚠️  {failed} tests failed - check output above for details")
        else:
            print("\n🎉 All automated tests passed!")
    
    # List interactive tests
    if interactive_tests:
        print(f"\nINTERACTIVE TESTS (run manually):")
        for test_file in interactive_tests:
            print(f"  python {test_file.name}")
        print("\nThese tests require manual interaction to verify functionality.")
    
    print(f"\nTest run complete!")
    
    return 0 if not automated_tests or failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())