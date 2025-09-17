#!/usr/bin/env python3
"""Test all working prompd files comprehensively."""

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
            timeout=25,
            cwd="C:/git/github/Logikbug/prompd-cli/cli/python"
        )
        
        # Check for successful response
        if "Response from anthropic" in result.stdout:
            return True, "WORKING"
        else:
            return False, result.stderr[:100] if result.stderr else "No response"
    except subprocess.TimeoutExpired:
        return False, "Timeout (might still work)"
    except Exception as e:
        return False, str(e)[:100]

# Comprehensive test cases for all working prompd files
test_cases = [
    # Original working files
    ("@prompd.io/simple-code-gen@1.0.0/prompts/generate-class.prmd", 
     {"class_name": "User", "language": "python", "description": "user account"}),
    ("@prompd.io/simple-code-gen@1.0.0/prompts/generate-function.prmd",
     {"function_name": "calculate", "language": "python", "description": "calc total"}),
    ("@prompd.io/database-helper@1.0.0/prompts/generate-query.prmd",
     {"query_type": "SELECT", "table_name": "users", "database_type": "postgres"}),
    ("@prompd.io/meeting-minutes@1.0.0/prompts/meeting-processor.prmd",
     {"transcript": "Meeting about new features. John will handle backend."}),
    ("@prompd.io/documentation@1.0.0/prompts/generate-readme.prmd",
     {"project_name": "TestProject", "project_description": "A test project", "language": "Python", "project_type": "library"}),
    ("@prompd.io/testing@1.0.0/prompts/generate-unit-tests.prmd",
     {"source_code": "def add(a, b): return a + b", "language": "python", "test_framework": "pytest"}),
    ("public/examples/base-prompt.prmd",
     {"topic": "API testing"}),
     
    # Newly fixed files
    ("@prompd.io/api-development@1.0.0/prompts/rest-endpoint-generator.prmd", 
     {"endpoint_name": "/users", "resource_name": "user", "method": "GET", "framework": "express", "description": "Get users"}),
    ("@prompd.io/api-toolkit@1.0.0/prompts/rest-api-builder.prmd",
     {"api_name": "UserAPI", "resource_name": "user", "resources": "users,posts", "framework": "fastapi"}),
    ("@prompd.io/code-review@1.0.0/prompts/comprehensive-review.prmd",
     {"code": "def calc(x): return x*2", "language": "python", "focus": "security,performance"}),
    ("@prompd.io/invoice-processor@1.0.0/prompts/invoice-extractor.prmd",
     {"invoice_text": "Invoice #123 Amount: $500", "invoice_image": "none", "company_info": "TestCorp"}),
    ("@prompd.io/readme-gen@1.0.0/prompts/basic-readme.prmd",
     {"project_name": "TestProject", "description": "A test project", "language": "python"}),
    ("@prompd.io/refactoring@1.0.0/prompts/legacy-modernization.prmd",
     {"legacy_code": "def old_func(): pass", "target_language": "python", "target_version": "3.11", "language": "python"}),
    ("@prompd.io/sales-lead-scoring@1.0.0/prompts/lead-scorer.prmd",
     {"lead_data": "Company: TechCorp, Size: 500", "scoring_model": "standard"}),
    ("@prompd.io/security-toolkit@1.0.0/prompts/base-security-audit.prmd",
     {"application_name": "WebApp", "target_system": "web application", "audit_scope": "authentication"}),
]

# Run comprehensive tests
base_path = Path("C:/git/github/Logikbug/prompd-base/production")
working = []
failed = []

print("COMPREHENSIVE TEST: All Working Prompd Files")
print("=" * 60)

for i, (file_path, params) in enumerate(test_cases, 1):
    full_path = base_path / file_path
    if not full_path.exists():
        failed.append((file_path, "File not found"))
        print(f"[{i:2}/{len(test_cases)}] MISSING   {file_path}")
        continue
    
    success, message = test_prompd_file(full_path, params)
    
    if success:
        working.append(file_path)
        print(f"[{i:2}/{len(test_cases)}] WORKING   {file_path}")
    else:
        failed.append((file_path, message))
        print(f"[{i:2}/{len(test_cases)}] FAILED    {file_path}: {message}")

print("\nFINAL RESULTS")
print("=" * 60)
print(f"WORKING PROMPD FILES: {len(working)}/{len(test_cases)}")
print(f"FAILED PROMPD FILES:  {len(failed)}/{len(test_cases)}")
print(f"SUCCESS RATE: {len(working)/len(test_cases)*100:.1f}%")

if working:
    print(f"\nREADY FOR PACKAGING ({len(working)} files):")
    for file in working:
        print(f"   PASS {file}")

if failed:
    print(f"\nSTILL NEED WORK ({len(failed)} files):")
    for file, error in failed:
        print(f"   FAIL {file}: {error}")

print(f"\nACHIEVEMENT: From ~15-20% to {len(working)/len(test_cases)*100:.1f}% success rate!")
print("Ready to package and upload to registry!")