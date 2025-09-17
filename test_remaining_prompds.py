#!/usr/bin/env python3
"""Test remaining prompd files to identify which need fixes."""

import subprocess
import sys
from pathlib import Path

def test_prompd_file(file_path, params):
    """Test if a prompd file works with LLM execution."""
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
        
        # Check for successful response
        if "Response from anthropic" in result.stdout:
            return True, "Works"
        elif "system file not found" in result.stderr.lower():
            return False, "Missing system file"
        elif "template file not found" in result.stderr.lower():
            return False, "Missing template file"
        elif "compilation failed" in result.stderr.lower():
            return False, "Compilation error"
        else:
            return False, result.stderr[:100] if result.stderr else "Unknown error"
    except subprocess.TimeoutExpired:
        return False, "Timeout"
    except Exception as e:
        return False, str(e)[:100]

# Test cases for remaining prompd files
test_cases = [
    ("@prompd.io/api-development@1.0.0/prompts/rest-endpoint-generator.prmd", 
     {"endpoint_name": "/users", "resource_name": "user", "method": "GET", "framework": "express", "description": "Get users"}),
    ("@prompd.io/api-toolkit@1.0.0/prompts/rest-api-builder.prmd",
     {"api_name": "UserAPI", "resource_name": "user", "resources": "users,posts", "framework": "fastapi"}),
    ("@prompd.io/code-review@1.0.0/prompts/comprehensive-review.prmd",
     {"code": "def calc(x): return x*2", "language": "python", "focus": "security,performance"}),
    ("@prompd.io/core-patterns@2.0.0/templates/analysis-framework.prmd",
     {"topic": "API design", "scope": "analysis"}),
    ("@prompd.io/invoice-processor@1.0.0/prompts/invoice-extractor.prmd",
     {"invoice_text": "Invoice #123 Amount: $500", "invoice_image": "none", "company_info": "TestCorp"}),
    ("@prompd.io/readme-gen@1.0.0/prompts/basic-readme.prmd",
     {"project_name": "TestProject", "description": "A test project", "language": "python"}),
    ("@prompd.io/refactoring@1.0.0/prompts/legacy-modernization.prmd",
     {"code": "def old_func(): pass", "language": "python", "target_version": "3.11"}),
    ("@prompd.io/sales-lead-scoring@1.0.0/prompts/lead-scorer.prmd",
     {"lead_data": "Company: TechCorp, Size: 500", "scoring_model": "standard"}),
    ("@prompd.io/security-toolkit@1.0.0/prompts/base-security-audit.prmd",
     {"target_system": "web application", "audit_scope": "authentication"}),
]

# Run tests
base_path = Path("C:/git/github/Logikbug/prompd-base/production")
working = []
needs_fix = []

print("Testing remaining prompd files...\n")
print("-" * 60)

for file_path, params in test_cases:
    full_path = base_path / file_path
    if not full_path.exists():
        needs_fix.append((file_path, "File not found"))
        print(f"MISSING {file_path}")
        continue
    
    success, message = test_prompd_file(full_path, params)
    
    if success:
        working.append(file_path)
        print(f"WORKS   {file_path}")
    else:
        needs_fix.append((file_path, message))
        print(f"NEEDS_FIX {file_path}: {message}")

print("\n" + "=" * 60)
print(f"\nSUMMARY:")
print(f"Working: {len(working)}")
print(f"Need fixes: {len(needs_fix)}")

if needs_fix:
    print(f"\nFILES NEEDING FIXES:")
    for file_path, error in needs_fix:
        print(f"  - {file_path}: {error}")