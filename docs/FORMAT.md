# Prompd File Format Specification

## Overview

Prompd files (`.prompd`) are structured prompt definitions that combine YAML frontmatter with Markdown content. They enable parameterized, versionable, and reusable AI prompts.

## File Structure

```yaml
---
# YAML Frontmatter (required)
---

# Markdown Content (optional if content defined in YAML)
```

## YAML Frontmatter

### Required Fields

#### `name` (string, required)
Unique identifier for the prompt. Must use kebab-case.

```yaml
name: code-reviewer
name: data-analyzer
name: creative-writer-v2
```

### Optional Fields

#### `version` (string)
Semantic version number (major.minor.patch).

```yaml
version: 1.2.3
```

#### `description` (string)
Brief description of the prompt's purpose.

```yaml
description: Reviews code for security vulnerabilities and best practices
```

#### `parameters` (array)
List of parameter definitions with validation rules.

```yaml
parameters:
  - name: language
    type: string
    required: true
    description: Programming language
    
  - name: max_lines
    type: integer
    default: 100
    min_value: 1
    max_value: 1000
```

### Parameter Definition

Each parameter can have:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Parameter identifier | `user_name` |
| `type` | enum | Data type | `string`, `integer`, `float`, `boolean`, `array`, `object` |
| `required` | boolean | Is parameter required? | `true`, `false` |
| `default` | any | Default value | `"hello"`, `42`, `true` |
| `description` | string | Parameter description | `"User's full name"` |
| `pattern` | string | Regex pattern (strings only) | `"^[a-z]+$"` |
| `error_message` | string | Custom validation error | `"Must be lowercase"` |
| `min_value` | number | Minimum value (numbers only) | `0` |
| `max_value` | number | Maximum value (numbers only) | `100` |

### Content in YAML

You can define prompt content directly in YAML:

```yaml
system: |
  You are an expert **{role}** with deep knowledge of {domain}.
  
  Your responsibilities:
  - Provide accurate information
  - Use clear explanations
  - Include `code examples`

context: "The user is working on: **{project}**"

user: |
  Please help me with {task}.
  
  Requirements:
  1. Be specific
  2. Include examples
  3. Explain reasoning

response: |
  Format your response as:
  
  ## Solution
  Your solution here
  
  ## Explanation
  Why this works
```

### YAML String Styles

#### Literal Block Scalar (`|`)
Preserves line breaks and indentation:

```yaml
system: |
  Line 1
  Line 2
  
  New paragraph
```

#### Folded Block Scalar (`>`)
Folds lines into spaces (like paragraph text):

```yaml
description: >
  This will become a single line
  unless there are blank lines
  to separate paragraphs.
```

#### Quoted Strings
For inline content:

```yaml
system: "You are a **helpful** assistant"
context: 'Working with {language}'
```

## Markdown Content

### Section Headers

Special headers define prompt structure:

```markdown
# System
Define the AI's role and behavior

# Context
Provide background information

# User
The user's request

# Response
Expected response format

# Assistant
AI's response (for examples)
```

### Markdown Features

All standard Markdown is supported:

```markdown
# System

You are an **expert developer** with knowledge of:

- *Design patterns*
- `Clean code` principles
- Test-driven development

## Your Approach

1. Analyze requirements
2. Design solution
3. Implement with **best practices**

```python
def example():
    return "Code blocks work"
```

> Important: Always consider security

| Feature | Support |
|---------|---------|
| Tables | Yes |
| Links | Yes |

---

[Documentation](https://example.com)
![Diagrams](image.png)
```

### Variable Substitution

#### Simple Variables
```markdown
Hello {name}, let's discuss {topic}.
```

#### Nested Variables
```markdown
API Key: {inputs.api_key}
User ID: {inputs.user.id}
```

#### Jinja2 Templates
```markdown
{%- if mode == "detailed" %}
Provide comprehensive analysis with examples.
{%- else %}
Provide a brief summary.
{%- endif %}

{%- for item in items %}
- Process {item}
{%- endfor %}
```

## Complete Examples

### Example 1: Simple Prompt

```yaml
---
name: translator
version: 1.0.0
description: Translates text between languages
parameters:
  - name: source_lang
    type: string
    default: English
  - name: target_lang
    type: string
    required: true
  - name: text
    type: string
    required: true
---

# System

You are a professional translator fluent in {source_lang} and {target_lang}.

# User

Translate the following from {source_lang} to {target_lang}:

{text}

# Response

Provide:
1. Direct translation
2. Alternative phrasings (if applicable)
3. Cultural context notes
```

### Example 2: YAML-Only Content

```yaml
---
name: code-reviewer
version: 2.0.0
description: Reviews code for quality and security

parameters:
  - name: language
    type: string
    required: true
  - name: code
    type: string
    required: true

system: |
  You are a **senior code reviewer** specializing in {language}.
  
  Focus on:
  - Security vulnerabilities
  - Performance issues
  - Code style and clarity
  - Best practices

user: |
  Review this {language} code:
  
  ```{language}
  {code}
  ```

response: |
  ## Code Review
  
  ### Issues Found
  List any problems
  
  ### Suggestions
  Improvement recommendations
  
  ### Security Analysis
  Any vulnerabilities
---

# No markdown content needed - all defined in YAML
```

### Example 3: Advanced Features

```yaml
---
name: data-processor
version: 3.1.0
description: Processes data with multiple options

parameters:
  - name: format
    type: string
    pattern: "^(json|xml|csv)$"
    error_message: "Format must be json, xml, or csv"
    default: json
    
  - name: rows
    type: integer
    min_value: 1
    max_value: 10000
    default: 100
    
  - name: include_headers
    type: boolean
    default: true
    
  - name: columns
    type: array
    description: List of column names
    
  - name: options
    type: object
    description: Advanced options

system: |
  You are a data processing expert.
  
  {%- if format == "json" %}
  Output valid JSON with proper formatting.
  {%- elif format == "xml" %}
  Output well-formed XML with appropriate schema.
  {%- else %}
  Output CSV with proper escaping.
  {%- endif %}

context: |
  Processing {rows} rows of data.
  Format: **{format}**
  {%- if include_headers %}
  Headers will be included.
  {%- endif %}
  
  Columns: {columns}

user: |
  Process the data according to the specifications.
  
  {%- for column in columns %}
  - Column: {column}
  {%- endfor %}
  
  Additional options: {options}
---

# Response

Your processed data in {format} format:

{%- if include_headers %}
Include column headers as specified.
{%- endif %}
```

## Best Practices

### Naming Conventions
- Use kebab-case for prompt names: `code-reviewer`, not `code_reviewer`
- Use snake_case for parameters: `user_name`, not `userName`
- Use clear, descriptive names

### Versioning
- Follow semantic versioning (major.minor.patch)
- Major: Breaking changes
- Minor: New features, backward compatible
- Patch: Bug fixes

### Organization
- Keep system prompts concise and focused
- Use context for background information
- Make user sections clear and specific
- Define expected response format explicitly

### Markdown vs YAML Content
- **Use YAML** for:
  - Short, simple prompts
  - Programmatically generated content
  - Multiple template variations
  
- **Use Markdown** for:
  - Long, complex prompts
  - Heavy formatting needs
  - Better readability

### Parameter Design
- Provide sensible defaults
- Use validation for critical inputs
- Include helpful descriptions
- Group related parameters

## Validation Rules

1. **Required Fields**: `name` must be present
2. **Name Format**: Must match `^[a-z0-9-]+$`
3. **Version Format**: Must match `^\d+\.\d+\.\d+$` if present
4. **Parameter Names**: Must match `^[a-z_][a-z0-9_]*$`
5. **Variable References**: All `{variable}` must be defined in parameters
6. **Type Consistency**: Values must match declared types

## File Extension

Always use `.prompd` extension for prompt definition files.

## Encoding

Files must be UTF-8 encoded.

## Comments

- YAML comments: Use `#`
- Jinja2 comments: Use `{# comment #}`
- Markdown comments: Use `<!-- comment -->`