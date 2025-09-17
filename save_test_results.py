#!/usr/bin/env python3
"""Save test results for working prompd files."""

import subprocess
import sys
from pathlib import Path

def test_and_save_result(file_path, params, output_file):
    """Test a prompd file and save the result."""
    cmd = [
        sys.executable, "-m", "prompd.cli", "run",
        str(file_path),
        "--provider", "anthropic",
        "--model", "claude-3-haiku-20240307"
    ]
    
    # Add parameters
    for key, value in params.items():
        cmd.extend(["-p", f"{key}={value}"])
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=20,
            cwd="C:/git/github/Logikbug/prompd-cli/cli/python"
        )
        
        # Save the full output
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"# Test Results for {file_path}\n\n")
            f.write(f"## Parameters Used:\n")
            for key, value in params.items():
                f.write(f"- {key}: {value}\n")
            f.write(f"\n## Command:\n```\n{' '.join(cmd)}\n```\n\n")
            
            if "Response from anthropic" in result.stdout:
                f.write(f"## Status: ✅ SUCCESS\n\n")
                f.write(f"## LLM Response:\n{result.stdout}\n")
                return True
            else:
                f.write(f"## Status: ❌ FAILED\n\n")
                f.write(f"## Error Output:\n{result.stderr}\n")
                f.write(f"## Stdout:\n{result.stdout}\n")
                return False
                
    except Exception as e:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"# Test Results for {file_path}\n\n")
            f.write(f"## Status: ❌ ERROR\n\n")
            f.write(f"## Exception: {str(e)}\n")
        return False

# Key working files to test and save
test_cases = [
    ("@prompd.io/api-development@1.0.0/prompts/rest-endpoint-generator.prmd", 
     {"endpoint_name": "/users", "resource_name": "user", "method": "GET", "framework": "express", "description": "Get users"}),
    ("@prompd.io/code-review@1.0.0/prompts/comprehensive-review.prmd",
     {"code": "def calc(x): return x*2", "language": "python", "focus": "security,performance"}),
    ("@prompd.io/refactoring@1.0.0/prompts/legacy-modernization.prmd",
     {"legacy_code": "def old_func(): pass", "target_language": "python", "target_version": "3.11", "language": "python"}),
    ("@prompd.io/security-toolkit@1.0.0/prompts/base-security-audit.prmd",
     {"application_name": "WebApp", "target_system": "web application", "audit_scope": "authentication"}),
    ("@prompd.io/invoice-processor@1.0.0/prompts/invoice-extractor.prmd",
     {"invoice_text": "Invoice #123 Amount: $500", "invoice_image": "none", "company_info": "TestCorp"}),
]

# Create results directory
results_dir = Path("C:/git/github/Logikbug/prompd-base/results")
results_dir.mkdir(exist_ok=True)

base_path = Path("C:/git/github/Logikbug/prompd-base/production")
working_count = 0
total_count = len(test_cases)

print("Saving test results for working prompd files...")
print("-" * 50)

for file_path, params in test_cases:
    full_path = base_path / file_path
    package_name = file_path.split('@')[0].replace('@prompd.io/', '').replace('/', '-')
    output_file = results_dir / f"{package_name}-test-results.md"
    
    print(f"Testing {package_name}...")
    
    if test_and_save_result(full_path, params, output_file):
        working_count += 1
        print(f"  SAVED: {output_file}")
    else:
        print(f"  FAILED: {output_file}")

print(f"\nResults saved to: {results_dir}")
print(f"Working files: {working_count}/{total_count}")
print(f"Success rate: {working_count/total_count*100:.1f}%")