"""Create command for generating new .prmd files"""

from pathlib import Path
from typing import Optional, Dict, Any
import click
from rich.console import Console
from rich.prompt import Prompt, Confirm

console = Console()


def create_prmd_file(
    file_path: Path,
    interactive: bool = False,
    name: Optional[str] = None,
    description: Optional[str] = None,
    author: Optional[str] = None,
    version: str = "1.0.0",
    template: Optional[str] = None
) -> None:
    """Create a new .prmd file with the specified options."""

    # Ensure .prmd extension
    if not str(file_path).endswith('.prmd'):
        file_path = Path(str(file_path) + '.prmd')

    # Interactive mode
    params = []
    if interactive:
        # Show just the filename with .prmd extension
        display_name = file_path.name
        if not display_name.endswith('.prmd'):
            display_name += '.prmd'
        console.print(f"[bold blue]Creating new ./{display_name} interactively[/bold blue]")
        console.print()

        name = Prompt.ask("Prompt name", default=name or file_path.stem.replace('-', ' ').title())
        description = Prompt.ask("Description", default=description or "")
        author = Prompt.ask("Author", default=author or "")
        version = Prompt.ask("Version", default=version)

        # Ask about parameters
        if Confirm.ask("Add parameters?", default=False):
            console.print("[dim]Adding parameters (press Enter on empty name to finish)[/dim]")
            while True:
                param_name = Prompt.ask("Parameter name (blank to finish)")
                if not param_name:
                    break
                param_type = Prompt.ask("Parameter type", choices=["string", "integer", "float", "boolean"], default="string")
                param_desc = Prompt.ask("Parameter description", default="")
                param_required = Confirm.ask("Required?", default=False)

                # Ask for default value if not required
                param_default = None
                if not param_required:
                    has_default = Confirm.ask("Add default value?", default=False)
                    if has_default:
                        if param_type == "boolean":
                            param_default = Confirm.ask("Default value", default=False)
                        else:
                            param_default = Prompt.ask(f"Default value ({param_type})", default="")
                            # Convert to appropriate type
                            if param_type == "integer" and param_default:
                                try:
                                    param_default = int(param_default)
                                except ValueError:
                                    console.print("[yellow]Warning:[/yellow] Invalid integer, using as string")
                            elif param_type == "float" and param_default:
                                try:
                                    param_default = float(param_default)
                                except ValueError:
                                    console.print("[yellow]Warning:[/yellow] Invalid float, using as string")

                param_data = {
                    "name": param_name,
                    "type": param_type,
                    "description": param_desc,
                    "required": param_required
                }

                if param_default is not None and param_default != "":
                    param_data["default"] = param_default

                params.append(param_data)

        # Ask about template
        if not template:
            use_template = Confirm.ask("Use a template?", default=False)
            if use_template:
                template = Prompt.ask("Template", choices=['basic', 'analysis', 'security', 'code-review', 'creative'])

    # Validate required fields in direct mode (unless template provides defaults)
    elif not interactive:
        # Generate defaults from template or filename if not provided
        if not name:
            if template:
                name = f"{template.title()} Prompt"
            else:
                name = file_path.stem.replace('-', ' ').title()

        if not description:
            if template:
                template_descriptions = {
                    'basic': 'A basic prompt template',
                    'analysis': 'Analysis framework for structured evaluation',
                    'security': 'Comprehensive security analysis and review',
                    'code-review': 'Code quality and security review template',
                    'creative': 'Creative content generation template'
                }
                description = template_descriptions.get(template, 'Generated from template')
            else:
                raise ValueError("--description is required when no template is specified")

    # Generate content
    content = generate_prmd_content(
        name=name,
        description=description,
        author=author,
        version=version,
        template=template,
        parameters=params  # Pass params regardless of mode
    )

    # Check if file exists
    if file_path.exists():
        if interactive:
            if not Confirm.ask(f"{file_path} already exists. Overwrite?", default=False):
                raise SystemExit("Cancelled")
        else:
            raise FileExistsError(f"{file_path} already exists. Use interactive mode to overwrite.")

    # Create parent directory if it doesn't exist
    file_path.parent.mkdir(parents=True, exist_ok=True)

    # Write file
    file_path.write_text(content, encoding='utf-8')


def generate_prmd_content(
    name: str,
    description: str,
    author: str = "",
    version: str = "1.0.0",
    template: Optional[str] = None,
    parameters: list = None
) -> str:
    """Generate the content for a .prmd file."""

    # Build YAML frontmatter
    yaml_lines = ["---"]
    yaml_lines.append(f'name: "{name}"')
    yaml_lines.append(f'description: "{description}"')
    yaml_lines.append(f'version: "{version}"')
    if author:
        yaml_lines.append(f'author: "{author}"')

    # Add parameters (list format)
    if parameters:
        yaml_lines.append("parameters:")
        for param in parameters:
            yaml_lines.append(f'  - name: {param["name"]}')
            yaml_lines.append(f'    type: {param["type"]}')
            if param["required"]:
                yaml_lines.append(f'    required: true')
            if param.get("description"):
                yaml_lines.append(f'    description: {param["description"]}')
            if "default" in param:
                if param["type"] == "string":
                    yaml_lines.append(f'    default: {param["default"]}')
                else:
                    yaml_lines.append(f'    default: {param["default"]}')
    else:
        yaml_lines.append("parameters: []")

    yaml_lines.append("---")

    # Generate body based on template
    body = get_template_body(template, name, description, parameters)

    return "\n".join(yaml_lines) + "\n\n" + body


def get_template_body(template: Optional[str], name: str, description: str, parameters: list = None) -> str:
    """Get the body content based on the selected template."""

    # Create parameter usage examples if parameters exist
    param_section = ""
    if parameters:
        param_examples = []
        for param in parameters:
            param_examples.append(f"{{{{ {param['name']} }}}}")
        param_section = f"\n\n## Parameters in Use\n\nThis prompt uses: {', '.join(param_examples)}\n"

    templates = {
        'basic': f"""# {name}

{description}{param_section}

## Instructions

[Your prompt instructions here]

## Context

[Provide context for the AI assistant]

## Expected Output

[Describe the expected output format]""",

        'analysis': f"""# {name}

{description}{param_section}

## Analysis Framework

Analyze the provided {{{{ subject | default('content') }}}} using the following framework:

### 1. Overview
Provide a high-level summary of the key findings.

### 2. Detailed Analysis
- **Strengths**: What works well?
- **Weaknesses**: What could be improved?
- **Opportunities**: What potential exists?
- **Risks**: What challenges or threats are present?

### 3. Recommendations
Based on the analysis, provide actionable recommendations.

## Output Format
Structure your response with clear headings and bullet points for readability.""",

        'security': f"""# Security Analysis: {name}

{description}{param_section}

## Security Review Scope

Perform a comprehensive security analysis focusing on:

### 1. Vulnerability Assessment
- Identify potential security vulnerabilities
- Classify by severity (Critical, High, Medium, Low)
- Consider OWASP Top 10 and CWE classifications

### 2. Threat Modeling
- Identify potential threat actors
- Map attack vectors
- Assess likelihood and impact

### 3. Compliance Check
- Review against industry best practices
- Consider relevant compliance frameworks (SOC2, ISO27001, PCI-DSS, etc.)

### 4. Recommendations
- Immediate actions required
- Short-term improvements
- Long-term security strategy

## Output Format
Provide a structured security report with clear severity ratings and actionable remediation steps.""",

        'code-review': f"""# Code Review: {name}

{description}{param_section}

## Review Criteria

Review the provided code for:

### Code Quality
- Readability and maintainability
- Adherence to coding standards
- Documentation completeness

### Functionality
- Correctness of implementation
- Edge case handling
- Error handling

### Performance
- Time complexity analysis
- Space complexity analysis
- Optimization opportunities

### Security
- Input validation
- Authentication/authorization
- Data protection

## Language-Specific Considerations
Review against language-specific best practices and idioms.

## Output Format
Provide specific line-by-line feedback with severity levels and suggested improvements.""",

        'creative': f"""# {name}

{description}{param_section}

## Creative Brief

### Objective
Create engaging content that resonates with the target audience

### Tone and Style
- Voice: Professional yet approachable
- Style: Clear and concise
- Perspective: Third person

### Target Audience
General audience

### Key Messages
1. Primary message
2. Supporting points
3. Call to action

## Deliverables
Provide creative content that:
- Captures attention
- Communicates clearly
- Drives engagement
- Achieves the stated objective"""
    }

    # Get template or use basic
    template_body = templates.get(template, templates['basic'])

    return template_body