"""Tests for prompd.models module."""

import pytest
from prompd.models import (
    ParameterDefinition, 
    ParameterType, 
    PrompdMetadata, 
    PrompdFile,
    LLMRequest,
    LLMResponse,
    ExecutionContext
)


class TestParameterDefinition:
    """Test ParameterDefinition model."""
    
    def test_parameter_definition_basic(self):
        """Test basic parameter definition creation."""
        param = ParameterDefinition(
            name="test_param",
            type=ParameterType.STRING,
            description="A test parameter"
        )
        
        assert param.name == "test_param"
        assert param.type == ParameterType.STRING
        assert param.description == "A test parameter"
        assert not param.required
        assert param.default is None
    
    def test_parameter_definition_with_defaults(self):
        """Test parameter definition with default values."""
        param = ParameterDefinition(
            name="count",
            type=ParameterType.INTEGER,
            required=True,
            default=10,
            min=1,
            max=100
        )
        
        assert param.name == "count"
        assert param.type == ParameterType.INTEGER
        assert param.required
        assert param.default == 10
        assert param.min_value == 1
        assert param.max_value == 100
    
    def test_parameter_definition_with_pattern(self):
        """Test parameter definition with regex pattern."""
        param = ParameterDefinition(
            name="email",
            type=ParameterType.STRING,
            pattern=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
            error_message="Invalid email format"
        )
        
        assert param.pattern is not None
        assert param.error_message == "Invalid email format"


class TestPrompdMetadata:
    """Test PrompdMetadata model."""
    
    def test_metadata_basic(self):
        """Test basic metadata creation."""
        metadata = PrompdMetadata(
            name="test-prompt",
            description="A test prompt",
            version="1.0.0"
        )
        
        assert metadata.name == "test-prompt"
        assert metadata.description == "A test prompt"
        assert metadata.version == "1.0.0"
        assert len(metadata.parameters) == 0
    
    def test_metadata_with_parameters(self):
        """Test metadata with parameters."""
        param = ParameterDefinition(name="topic", type=ParameterType.STRING)
        metadata = PrompdMetadata(
            name="test-prompt",
            parameters=[param]
        )
        
        assert len(metadata.parameters) == 1
        assert metadata.parameters[0].name == "topic"


class TestPrompdFile:
    """Test PrompdFile model."""
    
    def test_prompd_file_basic(self):
        """Test basic PrompdFile creation."""
        metadata = PrompdMetadata(name="test")
        prompd_file = PrompdFile(
            metadata=metadata,
            content="Test content",
            sections={"user": "Hello {name}"}
        )
        
        assert prompd_file.metadata.name == "test"
        assert prompd_file.content == "Test content"
        assert "user" in prompd_file.sections


class TestLLMModels:
    """Test LLM request/response models."""
    
    def test_llm_request(self):
        """Test LLM request creation."""
        request = LLMRequest(
            messages=[{"role": "user", "content": "Hello"}],
            model="gpt-4",
            temperature=0.7
        )
        
        assert len(request.messages) == 1
        assert request.model == "gpt-4"
        assert request.temperature == 0.7
    
    def test_llm_response(self):
        """Test LLM response creation."""
        response = LLMResponse(
            content="Hello! How can I help you?",
            model="gpt-4",
            usage={"prompt_tokens": 10, "completion_tokens": 8}
        )
        
        assert response.content == "Hello! How can I help you?"
        assert response.model == "gpt-4"
        assert response.usage["prompt_tokens"] == 10


class TestExecutionContext:
    """Test ExecutionContext model."""
    
    def test_execution_context(self):
        """Test execution context creation."""
        metadata = PrompdMetadata(name="test")
        prompd_file = PrompdFile(metadata=metadata, content="test")
        
        context = ExecutionContext(
            prompd=prompd_file,
            parameters={"name": "World"},
            provider="openai",
            model="gpt-4",
            api_key="test-key"
        )
        
        assert context.prompd.metadata.name == "test"
        assert context.parameters["name"] == "World"
        assert context.provider == "openai"
        assert context.model == "gpt-4"
        assert context.api_key == "test-key"