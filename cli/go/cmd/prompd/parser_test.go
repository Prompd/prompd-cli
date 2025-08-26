package main

import (
	"fmt"
	"strings"
	"testing"
	
	"gopkg.in/yaml.v3"
)

func TestParsePrompdFile(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		expectError bool
		expectedName string
		expectedParameterCount int
	}{
		{
			name: "Valid basic file",
			content: `---
name: test-prompt
version: 1.0.0
description: A test prompt
parameters:
  - name: topic
    type: string
    required: true
---

Please discuss: {topic}`,
			expectError:            false,
			expectedName:           "test-prompt",
			expectedParameterCount: 1,
		},
		{
			name: "Missing frontmatter",
			content: `This is just plain text without frontmatter`,
			expectError: true,
		},
		{
			name: "Invalid YAML",
			content: `---
name: test
invalid: yaml: structure: [
---

Content here`,
			expectError: true,
		},
		{
			name: "Missing name",
			content: `---
description: Missing name field
version: 1.0.0
---

Content here`,
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prompd, err := parsePrompdContent(tt.content)
			
			if tt.expectError {
				if err == nil {
					t.Errorf("Expected error but got none")
				}
				return
			}
			
			if err != nil {
				t.Errorf("Unexpected error: %v", err)
				return
			}
			
			if prompd.Metadata.Name != tt.expectedName {
				t.Errorf("Expected name %q, got %q", tt.expectedName, prompd.Metadata.Name)
			}
			
			if len(prompd.Metadata.Parameters) != tt.expectedParameterCount {
				t.Errorf("Expected %d parameters, got %d", tt.expectedParameterCount, len(prompd.Metadata.Parameters))
			}
		})
	}
}

func TestParsePrompdStructure(t *testing.T) {
	content := `---
name: test-structure
version: 1.0.0
description: Test structure parsing
system: You are a helpful assistant
user: Help with {task}
context: Background info
parameters:
  - name: task
    type: string
    required: true
---

Main content with {task} variable.`

	prompd, err := parsePrompdContent(content)
	if err != nil {
		t.Fatalf("Failed to parse content: %v", err)
	}
	
	if prompd.Metadata.System != "You are a helpful assistant" {
		t.Errorf("Expected system 'You are a helpful assistant', got '%s'", prompd.Metadata.System)
	}
	
	if prompd.Metadata.User != "Help with {task}" {
		t.Errorf("Expected user 'Help with {task}', got '%s'", prompd.Metadata.User)
	}
	
	if prompd.Metadata.Context != "Background info" {
		t.Errorf("Expected context 'Background info', got '%s'", prompd.Metadata.Context)
	}
}

func TestValidateParameters(t *testing.T) {
	metadata := PrompdMetadata{
		Name:    "test",
		Version: "1.0.0",
		Parameters: []Parameter{
			{Name: "required_param", Required: true},
			{Name: "optional_param", Required: false},
		},
	}

	tests := []struct {
		name        string
		params      map[string]interface{}
		expectError bool
	}{
		{
			name:        "All required parameters provided",
			params:      map[string]interface{}{"required_param": "value"},
			expectError: false,
		},
		{
			name:        "Missing required parameter",
			params:      map[string]interface{}{"optional_param": "value"},
			expectError: true,
		},
		{
			name:        "All parameters provided",
			params:      map[string]interface{}{"required_param": "value", "optional_param": "value"},
			expectError: false,
		},
		{
			name:        "No parameters provided",
			params:      map[string]interface{}{},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateParameters(metadata, tt.params)
			
			if tt.expectError && err == nil {
				t.Errorf("Expected error but got none")
			}
			
			if !tt.expectError && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

func TestSubstituteVariables(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		params   map[string]interface{}
		expected string
	}{
		{
			name:     "Single substitution",
			content:  "Hello {name}",
			params:   map[string]interface{}{"name": "Alice"},
			expected: "Hello Alice",
		},
		{
			name:     "Multiple substitutions",
			content:  "Hello {name}, you have {count} messages",
			params:   map[string]interface{}{"name": "Bob", "count": 5},
			expected: "Hello Bob, you have 5 messages",
		},
		{
			name:     "No substitutions needed",
			content:  "Plain text",
			params:   map[string]interface{}{},
			expected: "Plain text",
		},
		{
			name:     "Numeric parameter",
			content:  "Count: {count}",
			params:   map[string]interface{}{"count": 42},
			expected: "Count: 42",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := substituteVariables(tt.content, tt.params)
			
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// Helper function to test parsing content directly
func parsePrompdContent(content string) (*PrompdFile, error) {
	if !strings.HasPrefix(content, "---") {
		return nil, fmt.Errorf("content must start with frontmatter")
	}
	
	parts := strings.Split(content, "---")
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid format")
	}
	
	yamlContent := strings.TrimSpace(parts[1])
	markdownContent := strings.TrimSpace(parts[2])
	
	var metadata PrompdMetadata
	if err := yaml.Unmarshal([]byte(yamlContent), &metadata); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	
	if metadata.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	
	return &PrompdFile{
		Metadata: metadata,
		Content:  markdownContent,
	}, nil
}

// Helper function to validate parameters
func validateParameters(metadata PrompdMetadata, params map[string]interface{}) error {
	for _, param := range metadata.Parameters {
		if param.Required {
			if _, exists := params[param.Name]; !exists {
				return fmt.Errorf("required parameter missing: %s", param.Name)
			}
		}
	}
	return nil
}

// Helper function to substitute variables
func substituteVariables(content string, params map[string]interface{}) string {
	result := content
	for key, value := range params {
		placeholder := fmt.Sprintf("{%s}", key)
		replacement := fmt.Sprintf("%v", value)
		result = strings.ReplaceAll(result, placeholder, replacement)
	}
	return result
}