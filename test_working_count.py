#!/usr/bin/env python3
"""Quick test to count how many production files work with LLM."""

import subprocess
import sys
from pathlib import Path

def test_file(file_path):
    """Test if a prompd file works with LLM execution."""
    # Common test parameters
    params = {
        'class_name': 'User',
        'function_name': 'calculate',
        'language': 'python',
        'description': 'test implementation',
        'code': 'def test(): return True',
        'query': 'SELECT * FROM users',
        'query_type': 'SELECT',
        'table_name': 'users',
        'database_type': 'postgres',
        'project_name': 'TestProject',
        'api_name': 'TestAPI',
        'endpoint_name': '/users',
        'method': 'GET',
        'framework': 'express',
        'tech_stack': 'Python',
        'transcript': 'Meeting about features',
        'topic': 'API design',
        'scope': 'performance',
        'problem_type': 'classification',
        'dataset': 'customer data',
        'dataset_description': 'sales data',
        'analysis_goals': 'find trends',
        'target_system': 'web app',
        'audit_scope': 'auth',
        'invoice_text': 'Invoice $500',
        'lead_data': 'Company: Tech',
        'base_url': 'http://api.test.com',
        'input': 'test input',
        'text': 'test text'
    }
    
    cmd = [
        sys.executable, "-m", "prompd.cli", "run",
        str(file_path),
        "--provider", "anthropic",
        "--model", "claude-3-haiku-20240307"
    ]
    
    # Add all parameters
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
        
        return "Response from anthropic" in result.stdout
        
    except:
        return False

# Find all production prompd files
base_path = Path("C:/git/github/Logikbug/prompd-base/production")
files = list(base_path.rglob("*.prmd"))

print(f"Testing {len(files)} production files...")
print("-" * 40)

working = 0
for i, file_path in enumerate(files, 1):
    if test_file(file_path):
        working += 1
        status = "WORKS"
    else:
        status = "FAILS"
    
    name = file_path.relative_to(base_path)
    print(f"[{i:2}/{len(files)}] {status} - {name}")

print("=" * 40)
print(f"\nRESULT: {working} out of {len(files)} files work")
print(f"Success rate: {working/len(files)*100:.1f}%")