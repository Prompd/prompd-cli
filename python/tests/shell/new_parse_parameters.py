#!/usr/bin/env python3
"""New parameter parsing function"""

import re
from typing import Dict

def parse_parameters(param_text: str) -> Dict[str, str]:
    """Parse parameters from natural language text"""
    params = {}
    
    # Clean input text
    param_text = param_text.strip()
    
    # Try key=value patterns first (most explicit)
    equals_pattern = r'(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*\'([^\']*)\'|(\w+)\s*=\s*(.+?)(?:\s+\w+\s*=|\s*$)'
    matches = re.findall(equals_pattern, param_text)
    
    for match in matches:
        if match[0] and match[1]:  # Double quoted
            params[match[0]] = match[1]
        elif match[2] and match[3]:  # Single quoted
            params[match[2]] = match[3]
        elif match[4] and match[5]:  # Unquoted
            params[match[4]] = match[5]
    
    # If no equals patterns found, try space-separated key value pairs
    if not params:
        # Split on spaces and look for pairs
        words = param_text.split()
        i = 0
        while i < len(words) - 1:
            key = words[i]
            value = words[i + 1]
            
            # Skip common words that aren't parameters
            if key.lower() not in ['with', 'for', 'using', 'params', 'parameters', 'and']:
                # Handle quoted values that got split
                if value.startswith('"') or value.startswith("'"):
                    # Collect the full quoted value
                    quote_char = value[0]
                    full_value = value
                    j = i + 2
                    while j < len(words) and not full_value.endswith(quote_char):
                        full_value += " " + words[j]
                        j += 1
                    
                    # Remove quotes
                    if full_value.startswith(quote_char) and full_value.endswith(quote_char):
                        full_value = full_value[1:-1]
                    
                    params[key] = full_value
                    i = j
                else:
                    params[key] = value
                    i += 2
            else:
                i += 1
    
    return params

# Test the function
if __name__ == "__main__":
    test_cases = [
        "task_type = generate code",           # Spaces around =
        "task_type=generate_code",            # No spaces
        'task_type="generate code"',          # Quoted
        "app_name = MyApp language = python", # Multiple params with spaces
        "task_type generate_code",            # Space separated
    ]
    
    print("Testing new parameter parsing:")
    for test in test_cases:
        result = parse_parameters(test)
        print(f"'{test}' -> {result}")