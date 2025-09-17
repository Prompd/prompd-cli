#!/usr/bin/env python3
"""Test all production prompd files and count how many work."""

import subprocess
import json
from pathlib import Path
import sys

def test_prompd_file(file_path, test_params):
    """Test a single prompd file with LLM execution."""
    cmd = [
        sys.executable, "-m", "prompd.cli", "run",
        str(file_path),
        "--provider", "anthropic",
        "--model", "claude-3-haiku-20240307"
    ]
    
    # Add parameters
    for key, value in test_params.items():
        cmd.extend(["-p", f"{key}={value}"])
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd="C:/git/github/Logikbug/prompd-cli/cli/python"
        )
        
        # Check if we got a response (not just an error)
        if "Response from anthropic" in result.stdout:
            return True, "Success"
        else:
            return False, result.stderr[:200] if result.stderr else "No response"
    except subprocess.TimeoutExpired:
        return False, "Timeout"
    except Exception as e:
        return False, str(e)[:200]

# Define test parameters for each file
test_cases = [
    # Simple Code Gen
    ("@prompd.io/simple-code-gen@1.0.0/prompts/generate-class.prmd", 
     {"class_name": "User", "language": "python", "description": "user account"}),
    ("@prompd.io/simple-code-gen@1.0.0/prompts/generate-function.prmd",
     {"function_name": "calculate", "language": "python", "description": "calc total"}),
     
    # Database Helper
    ("@prompd.io/database-helper@1.0.0/prompts/generate-query.prmd",
     {"query_type": "SELECT", "table_name": "users", "database_type": "postgres"}),
    ("@prompd.io/database-helper@1.0.0/prompts/optimize-query.prmd",
     {"query": "SELECT * FROM users WHERE active = true", "database_type": "postgres"}),
     
    # API Development
    ("@prompd.io/api-development@1.0.0/prompts/generate-endpoint.prmd",
     {"endpoint_name": "/users", "method": "GET", "framework": "express"}),
    ("@prompd.io/api-development@1.0.0/prompts/api-documentation.prmd",
     {"api_name": "UserAPI", "endpoints": "/users, /posts", "format": "openapi"}),
     
    # Documentation
    ("@prompd.io/documentation@1.0.0/prompts/generate-readme.prmd",
     {"project_name": "TestProject", "description": "A test project", "tech_stack": "Python"}),
    ("@prompd.io/documentation@1.0.0/prompts/api-docs.prmd",
     {"api_name": "TestAPI", "base_url": "http://api.test.com"}),
     
    # Testing
    ("@prompd.io/testing@1.0.0/prompts/generate-unit-tests.prmd",
     {"code": "def add(a, b): return a + b", "language": "python", "framework": "pytest"}),
    ("@prompd.io/testing@1.0.0/prompts/test-scenarios.prmd",
     {"feature": "user login", "application_type": "web"}),
     
    # Code Review
    ("@prompd.io/code-review@1.0.0/prompts/review-code.prmd",
     {"code": "def calc(x): return x * 2", "language": "python"}),
    ("@prompd.io/code-review@1.0.0/prompts/security-review.prmd",
     {"code": "def login(user, pwd): return True", "language": "python"}),
     
    # Meeting Minutes
    ("@prompd.io/meeting-minutes@1.0.0/prompts/meeting-processor.prmd",
     {"transcript": "We discussed the new feature. John will handle backend."}),
    ("@prompd.io/meeting-minutes@1.0.0/prompts/action-items.prmd",
     {"minutes": "Discussed API changes. Need to update docs."}),
     
    # Core Patterns
    ("@prompd.io/core-patterns@2.0.0/systems/analytical-thinker.prmd",
     {"topic": "API design"}),
    ("@prompd.io/core-patterns@2.0.0/templates/structured-analysis.prmd",
     {"topic": "database optimization", "scope": "performance"}),
     
    # Data Science
    ("@prompd.io/data-science-toolkit@1.0.0/prompts/data-analysis.prmd",
     {"dataset_description": "sales data", "analysis_goals": "find trends"}),
    ("@prompd.io/data-science-toolkit@1.0.0/prompts/ml-pipeline-builder.prmd",
     {"problem_type": "classification", "dataset": "customer data"}),
     
    # Security Toolkit
    ("@prompd.io/security-toolkit@1.0.0/templates/base-security-audit.prmd",
     {"target_system": "web application", "audit_scope": "authentication"}),
    
    # Others
    ("@prompd.io/refactoring@1.0.0/prompts/refactor-code.prmd",
     {"code": "def x(a,b): return a+b", "language": "python"}),
    ("@prompd.io/invoice-processor@1.0.0/prompts/extract-invoice.prmd",
     {"invoice_text": "Invoice #123\nAmount: $500\nDue: 30 days"}),
    ("@prompd.io/sales-lead-scoring@1.0.0/prompts/score-lead.prmd",
     {"lead_data": "Company: TechCorp, Size: 500, Industry: Software"}),
]

# Run tests
base_path = Path("C:/git/github/Logikbug/prompd-base/production")
successful = []
failed = []

print("Testing production prompd files...\n")
print("-" * 60)

for file_path, params in test_cases:
    full_path = base_path / file_path
    if not full_path.exists():
        failed.append((file_path, "File not found"))
        print(f"FAIL {file_path}: File not found")
        continue
    
    success, message = test_prompd_file(full_path, params)
    
    if success:
        successful.append(file_path)
        print(f"PASS {file_path}")
    else:
        failed.append((file_path, message))
        print(f"FAIL {file_path}: {message[:50]}...")

print("\n" + "=" * 60)
print(f"\nRESULTS:")
print(f"Successful: {len(successful)}/{len(test_cases)}")
print(f"Failed: {len(failed)}/{len(test_cases)}")
print(f"Success Rate: {len(successful)/len(test_cases)*100:.1f}%")

if failed:
    print("\nFailed files:")
    for file_path, error in failed:
        print(f"  - {file_path}")