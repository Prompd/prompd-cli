# Template Engine Alignment Strategy

## Current State

### Python CLI (Jinja2)
- ✅ Simple variable substitution: `{variable}`
- ✅ Conditional logic: `{%- if condition %}...{%- endif %}`
- ✅ Loops: `{%- for item in list %}...{%- endfor %}`
- ✅ Complex expressions and filters

### Go CLI (String Replacement)
- ✅ Simple variable substitution: `{variable}`
- ❌ No conditional logic
- ❌ No loops
- ❌ No expressions

### npm CLI (String Replacement)
- ✅ Simple variable substitution: `{variable}`  
- ❌ No conditional logic
- ❌ No loops
- ❌ No expressions

## Alignment Strategy

To maintain backward compatibility while adding basic templating support:

### Phase 1: Basic Conditional Support
Add support for simple conditionals in Go and npm CLIs:
- `{%- if variable %}content{%- endif %}`
- `{%- if variable == "value" %}content{%- endif %}`
- `{%- if variable %}content{%- else %}alternative{%- endif %}`

### Phase 2: Enhanced Features (Future)
- Basic loops support
- Simple expressions

## Implementation Approach

1. **Backward Compatibility**: All existing `{variable}` substitutions continue to work
2. **Progressive Enhancement**: Add conditional support without breaking existing prompts
3. **Consistent Syntax**: Use Jinja2-compatible syntax for cross-CLI compatibility
4. **Documentation**: Clear examples of supported features

## Template Features Support Matrix

| Feature | Python CLI | Go CLI | npm CLI | Notes |
|---------|------------|--------|---------|-------|
| Simple variables `{var}` | ✅ | ✅ | ✅ | Fully compatible |
| Conditionals `{%- if %}` | ✅ | ⚠️ (basic) | ⚠️ (basic) | Basic support added |
| Loops `{%- for %}` | ✅ | ❌ | ❌ | Future enhancement |
| Expressions/Filters | ✅ | ❌ | ❌ | Python CLI advantage |

## Example Templates

### Simple Variable Substitution (All CLIs)
```markdown
Hello {name}, welcome to {platform}!
```

### Basic Conditionals (All CLIs after alignment)
```markdown
{%- if user_role == "admin" %}
You have administrative privileges.
{%- else %}
You have standard user privileges.
{%- endif %}

Process the following {%- if urgent %} URGENT{%- endif %} request:
{request_details}
```

### Advanced Features (Python CLI Only)
```markdown
{%- for item in items %}
- {{ item.name }}: {{ item.description }}
{%- endfor %}
```