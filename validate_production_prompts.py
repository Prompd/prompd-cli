#!/usr/bin/env python3
"""
Validation script for all production .prmd files in ../prompd-base/production
"""

import subprocess
import sys
from pathlib import Path
import json
from datetime import datetime

def run_prompd_validate(file_path):
    """Run prompd validate on a single file and return results."""
    try:
        # Use the Python CLI from our current directory
        result = subprocess.run(
            [sys.executable, "-m", "prompd.cli", "validate", str(file_path)],
            cwd="cli/python",
            capture_output=True,
            text=True,
            timeout=30
        )

        return {
            "file": str(file_path),
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "file": str(file_path),
            "success": False,
            "stdout": "",
            "stderr": "Validation timed out after 30 seconds",
            "returncode": -1
        }
    except Exception as e:
        return {
            "file": str(file_path),
            "success": False,
            "stdout": "",
            "stderr": f"Error running validation: {str(e)}",
            "returncode": -1
        }

def main():
    """Main validation function."""
    print("🚀 Starting validation of all production .prmd files...")
    print("=" * 80)

    # Find all .prmd files in production directory
    production_dir = Path("../prompd-base/production")
    if not production_dir.exists():
        print(f"❌ Production directory not found: {production_dir}")
        return 1

    prmd_files = list(production_dir.rglob("*.prmd"))
    print(f"📁 Found {len(prmd_files)} .prmd files to validate")
    print()

    results = []
    success_count = 0

    for i, file_path in enumerate(prmd_files, 1):
        relative_path = file_path.relative_to(production_dir)
        print(f"[{i:2d}/{len(prmd_files)}] Validating: {relative_path}")

        result = run_prompd_validate(file_path)
        results.append(result)

        if result["success"]:
            print(f"    ✅ VALID")
            success_count += 1
        else:
            print(f"    ❌ FAILED")
            if result["stderr"]:
                print(f"    📝 Error: {result['stderr']}")
            if result["stdout"]:
                print(f"    📝 Output: {result['stdout']}")
        print()

    # Summary
    print("=" * 80)
    print("📊 VALIDATION SUMMARY")
    print("=" * 80)
    print(f"Total files:     {len(prmd_files)}")
    print(f"✅ Valid:        {success_count}")
    print(f"❌ Failed:       {len(prmd_files) - success_count}")
    print(f"Success rate:    {(success_count / len(prmd_files) * 100):.1f}%")
    print()

    # Failed files details
    failed_files = [r for r in results if not r["success"]]
    if failed_files:
        print("❌ FAILED FILES:")
        print("-" * 40)
        for result in failed_files:
            rel_path = Path(result["file"]).relative_to(production_dir)
            print(f"• {rel_path}")
            if result["stderr"]:
                print(f"  Error: {result['stderr']}")
            if result["stdout"]:
                print(f"  Output: {result['stdout']}")
            print()

    # Save detailed results to JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"validation_results_{timestamp}.json"

    with open(results_file, 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "total_files": len(prmd_files),
            "success_count": success_count,
            "failed_count": len(prmd_files) - success_count,
            "success_rate": success_count / len(prmd_files) * 100,
            "results": results
        }, f, indent=2)

    print(f"📄 Detailed results saved to: {results_file}")

    # Return appropriate exit code
    return 0 if success_count == len(prmd_files) else 1

if __name__ == "__main__":
    sys.exit(main())