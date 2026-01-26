/**
 * Test Fixtures - Sample .prmd files and test data
 */

export const SIMPLE_PRMD = `---
id: simple-test
name: Simple Test
version: 1.0.0
description: Basic test file
parameters:
  - name: name
    type: string
    required: true
    default: "World"
  - name: age
    type: number
    default: 25
---

# System

You are a helpful assistant.

# User

Hello, {{name}}! You are {{age}} years old.`;

export const TEMPLATE_PRMD = `---
id: template-test
name: Template Test
version: 1.0.0
parameters:
  - name: items
    type: array
    default: ["apple", "banana"]
  - name: show_details
    type: boolean
    default: true
---

# User

{% if show_details %}
Items:
{% for item in items %}
- {{item}}
{% endfor %}
{% else %}
Count: {{items|length}}
{% endif %}`;

export const INHERITANCE_PRMD = `---
id: child-prompt
name: Child Prompt
version: 1.0.0
inherits: "./parent.prmd"
parameters:
  - name: topic
    type: string
    required: true
---

# User

Topic: {{topic}}`;

export const PARENT_PRMD = `---
id: parent-prompt
name: Parent Prompt
version: 1.0.0
parameters:
  - name: context
    type: string
    default: "general"
---

# System

You are an expert in {{context}}.

# User

Parent content here.`;

export const OVERRIDE_PRMD = `---
id: override-test
name: Override Test
version: 1.0.0
inherits: "./parent.prmd"
override:
  system: "./custom-system.md"
---

# User

Child user content.`;

export const PACKAGE_IMPORT_PRMD = `---
id: package-test
name: Package Test
version: 1.0.0
using:
  - name: "@prompd/core@1.0.0"
    prefix: "core"
---

# User

Using package: @core/template.prmd`;

export const INVALID_PRMD = `---
id: invalid-test
name: Invalid Test
parameters:
  - name: test
    type: invalid_type
---

# Content`;

export const NESTED_PARAMS_PRMD = `---
id: nested-test
name: Nested Parameters Test
version: 1.0.0
parameters:
  - name: user
    type: object
    default:
      name: "Alice"
      age: 30
---

# User

User: {{user.name}}, Age: {{user.age}}`;

export const CUSTOM_SYSTEM_MD = `This is a custom system prompt from an external file.`;

export const SAMPLE_EXCEL_PATH = '/tmp/test.xlsx';
export const SAMPLE_WORD_PATH = '/tmp/test.docx';
export const SAMPLE_PDF_PATH = '/tmp/test.pdf';
