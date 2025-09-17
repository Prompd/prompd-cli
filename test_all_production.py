#!/usr/bin/env python3
"""Test ALL production prompd files with smart parameter inference."""

import subprocess
import sys
from pathlib import Path
import re

def infer_parameters(file_path):
    """Test compilation of a prompd file"""
    try:
        result = subprocess.run(['prompd', 'compile', str(file_path), '--to-markdown'], 
                              capture_output=True, text=True, timeout=60)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def test_validation(file_path):
    """Test validation of a prompd file"""
    try:
        result = subprocess.run(['prompd', 'validate', str(file_path)], 
                              capture_output=True, text=True, timeout=30)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def main():
    production_dir = Path("../prompd-base/production")
    
    if not production_dir.exists():
        print(f"Production directory not found: {production_dir}")
        return
    
    # Find all .prmd files
    prmd_files = list(production_dir.rglob("*.prmd"))
    
    print(f"Testing {len(prmd_files)} production prompd files")
    print("=" * 80)
    
    validation_passed = 0
    validation_failed = 0
    compilation_passed = 0
    compilation_failed = 0
    
    results = []
    
    for file_path in prmd_files:
        rel_path = file_path.relative_to(production_dir)
        print(f"\nTesting: {rel_path}")
        
        # Test validation
        val_success, val_stdout, val_stderr = test_validation(file_path)
        if val_success:
            print("  Validation: PASS")
            validation_passed += 1
        else:
            print("  Validation: FAIL")
            print(f"    Error: {val_stderr}")
            validation_failed += 1
        
        # Test compilation
        comp_success, comp_stdout, comp_stderr = test_compilation(file_path)
        if comp_success:
            print("  Compilation: PASS")
            compilation_passed += 1
        else:
            print("  Compilation: FAIL") 
            print(f"    Error: {comp_stderr}")
            compilation_failed += 1
        
        results.append({
            'file': str(rel_path),
            'validation_pass': val_success,
            'validation_error': val_stderr if not val_success else None,
            'compilation_pass': comp_success,
            'compilation_error': comp_stderr if not comp_success else None
        })
    
    print("\n" + "=" * 80)
    print("VALIDATION RESULTS:")
    print(f"  Passed: {validation_passed}")
    print(f"  Failed: {validation_failed}")
    print(f"  Success Rate: {(validation_passed/(validation_passed+validation_failed)*100):.1f}%")
    
    print("\nCOMPILATION RESULTS:")
    print(f"  Passed: {compilation_passed}")
    print(f"  Failed: {compilation_failed}")
    print(f"  Success Rate: {(compilation_passed/(compilation_passed+compilation_failed)*100):.1f}%")
    
    # Save detailed results
    with open("production_test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\nDetailed results saved to: production_test_results.json")

if __name__ == "__main__":
    main()