"""Core data models for prompd."""

from typing import Dict, Any, List, Optional, Union
from enum import Enum
from pathlib import Path
from pydantic import BaseModel, Field, field_validator


class ParameterType(str, Enum):
    """Supported parameter types."""
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    ARRAY = "array"
    OBJECT = "object"


class ParameterDefinition(BaseModel):
    """Parameter definition in prompd metadata."""
    name: str
    type: ParameterType = ParameterType.STRING
    required: bool = False
    default: Optional[Any] = None
    description: str = ""
    example: Optional[Any] = None
    pattern: Optional[str] = None
    min_value: Optional[Union[int, float]] = Field(None, alias="min")
    max_value: Optional[Union[int, float]] = Field(None, alias="max")
    error_message: Optional[str] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        """Validate parameter name follows snake_case convention."""
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError(f"Parameter name must be alphanumeric with underscores/hyphens: {v}")
        return v


class ParameterValue(BaseModel):
    """Parameter value with optional metadata."""
    value: Any
    type: Optional[ParameterType] = None
    description: Optional[str] = None

    @classmethod
    def from_value(cls, value: Any) -> "ParameterValue":
        """Create ParameterValue from simple value."""
        return cls(value=value)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ParameterValue":
        """Create ParameterValue from dictionary with metadata."""
        if "value" in data:
            return cls(**data)
        else:
            # Treat as simple value
            return cls(value=data)


class ContentReference(BaseModel):
    """Base class for content references."""
    pass


class InlineContent(ContentReference):
    """Inline content."""
    content: str


class FileReference(ContentReference):
    """Reference to external file."""
    path: Path


class MultiFileReference(ContentReference):
    """Reference to multiple files."""
    paths: List[Path]


class SectionReference(ContentReference):
    """Reference to section within same file."""
    section: str


def parse_content_reference(value: Union[str, List[str], Dict[str, Any]]) -> ContentReference:
    """Parse content reference from various formats."""
    if isinstance(value, str):
        if value.startswith('#'):
            return SectionReference(section=value[1:])
        elif value.startswith('./') or value.startswith('/'):
            return FileReference(path=Path(value))
        else:
            return InlineContent(content=value)
    elif isinstance(value, list):
        return MultiFileReference(paths=[Path(p) for p in value])
    else:
        raise ValueError(f"Invalid content reference format: {value}")


class PrompdMetadata(BaseModel):
    """Metadata section of prompd file."""
    name: str
    description: Optional[str] = None
    version: Optional[str] = None
    author: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    parameters: List[ParameterDefinition] = Field(default_factory=list)
    requires: List[str] = Field(default_factory=list)
    inputs: Dict[str, Any] = Field(default_factory=dict)
    
    # Content references
    system: Optional[Union[str, List[str]]] = None
    context: Optional[Union[str, List[str]]] = None
    user: Optional[Union[str, List[str]]] = None
    response: Optional[Union[str, List[str]]] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        """Validate name follows kebab-case convention."""
        if not v.replace('-', '').replace('_', '').isalnum():
            raise ValueError(f"Name should use kebab-case: {v}")
        return v


class MessageRole(str, Enum):
    """LLM message roles."""
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class LLMMessage(BaseModel):
    """Single message in LLM conversation."""
    role: MessageRole
    content: str


class LLMRequest(BaseModel):
    """Complete LLM API request."""
    messages: List[LLMMessage]
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    response_format: Optional[Dict[str, Any]] = None
    extra_params: Dict[str, Any] = Field(default_factory=dict)


class LLMResponse(BaseModel):
    """LLM API response."""
    content: str
    model: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PrompdFile(BaseModel):
    """Complete parsed prompd file."""
    metadata: PrompdMetadata
    content: str  # Raw markdown content after frontmatter
    sections: Dict[str, str] = Field(default_factory=dict)  # Parsed sections
    file_path: Optional[Path] = None

    def get_parameter_definitions(self) -> Dict[str, ParameterDefinition]:
        """Get parameter definitions as a lookup dict."""
        return {param.name: param for param in self.metadata.parameters}

    def has_section(self, name: str) -> bool:
        """Check if file has a specific section."""
        return name in self.sections

    def get_section(self, name: str) -> Optional[str]:
        """Get section content by name."""
        return self.sections.get(name)


class ExecutionContext(BaseModel):
    """Context for executing a prompd file."""
    prompd: PrompdFile
    parameters: Dict[str, Any]
    provider: str
    model: str
    api_key: Optional[str] = None
    extra_config: Dict[str, Any] = Field(default_factory=dict)