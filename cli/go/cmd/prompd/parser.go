package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

type PrompdFile struct {
	Metadata PrompdMetadata `yaml:",inline"`
	Content  string
}

type PrompdMetadata struct {
	Name        string      `yaml:"name,omitempty"`
	Description string      `yaml:"description,omitempty"`
	Version     string      `yaml:"version,omitempty"`
	Parameters  []Parameter `yaml:"parameters,omitempty"`
	Variables   []Parameter `yaml:"variables,omitempty"` // For backward compatibility
	System      string      `yaml:"system,omitempty"`
	Context     string      `yaml:"context,omitempty"`
	User        string      `yaml:"user,omitempty"`
	Response    string      `yaml:"response,omitempty"`
	Requires    []string    `yaml:"requires,omitempty"`
}

type Parameter struct {
	Name        string      `yaml:"name"`
	Type        string      `yaml:"type"`
	Description string      `yaml:"description,omitempty"`
	Required    bool        `yaml:"required,omitempty"`
	Default     interface{} `yaml:"default,omitempty"`
	Pattern     string      `yaml:"pattern,omitempty"`
	Min         *float64    `yaml:"min,omitempty"`
	Max         *float64    `yaml:"max,omitempty"`
}

func parsePrompdFile(filename string) (*PrompdFile, error) {
	content, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	text := string(content)
	
	// Check if file starts with YAML frontmatter
	if !strings.HasPrefix(text, "---\n") {
		return nil, fmt.Errorf("file must start with YAML frontmatter (---)")
	}

	// Find the end of frontmatter
	parts := strings.SplitN(text[4:], "\n---\n", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid frontmatter format")
	}

	yamlContent := parts[0]
	markdownContent := parts[1]

	var metadata PrompdMetadata
	if err := yaml.Unmarshal([]byte(yamlContent), &metadata); err != nil {
		return nil, fmt.Errorf("failed to parse YAML frontmatter: %w", err)
	}

	return &PrompdFile{
		Metadata: metadata,
		Content:  markdownContent,
	}, nil
}

func validateFile(filename string) error {
	if !strings.HasSuffix(filename, ".prompd") {
		return fmt.Errorf("file must have .prompd extension")
	}

	prompd, err := parsePrompdFile(filename)
	if err != nil {
		return err
	}

	// Validate required fields
	if prompd.Metadata.Name == "" {
		return fmt.Errorf("name field is required")
	}

	// Validate semantic version if present
	if prompd.Metadata.Version != "" && !isValidSemver(prompd.Metadata.Version) {
		return fmt.Errorf("invalid semantic version: %s", prompd.Metadata.Version)
	}

	// Validate parameter references
	variables := make(map[string]bool)
	
	// Check both parameters and variables fields for backward compatibility
	allParams := append(prompd.Metadata.Parameters, prompd.Metadata.Variables...)
	validTypes := map[string]bool{
		"string":  true,
		"integer": true,
		"float":   true,
		"boolean": true,
		"array":   true,
		"object":  true,
	}
	
	for _, param := range allParams {
		if param.Name == "" {
			return fmt.Errorf("parameter name cannot be empty")
		}
		
		// Validate parameter type
		if param.Type != "" && !validTypes[param.Type] {
			return fmt.Errorf("invalid parameter type '%s' for parameter '%s'. Must be one of: string, integer, float, boolean, array, object", param.Type, param.Name)
		}
		
		// Validate pattern if present (for string types)
		if param.Pattern != "" {
			if param.Type != "" && param.Type != "string" {
				return fmt.Errorf("pattern validation is only valid for string type parameters, but '%s' has type '%s'", param.Name, param.Type)
			}
			// Test if pattern is valid regex
			if _, err := regexp.Compile(param.Pattern); err != nil {
				return fmt.Errorf("invalid regex pattern for parameter '%s': %v", param.Name, err)
			}
		}
		
		// Validate min/max constraints (for numeric types)
		if param.Min != nil || param.Max != nil {
			if param.Type != "" && param.Type != "integer" && param.Type != "float" {
				return fmt.Errorf("min/max constraints are only valid for numeric types, but '%s' has type '%s'", param.Name, param.Type)
			}
			if param.Min != nil && param.Max != nil && *param.Min > *param.Max {
				return fmt.Errorf("min value (%v) cannot be greater than max value (%v) for parameter '%s'", *param.Min, *param.Max, param.Name)
			}
		}
		
		// Validate default value type matches parameter type
		if param.Default != nil && param.Type != "" {
			if err := validateDefaultType(param.Name, param.Type, param.Default); err != nil {
				return err
			}
		}
		
		variables[param.Name] = true
	}

	// Check for variable references in content
	re := regexp.MustCompile(`\{([a-zA-Z_][a-zA-Z0-9_]*)\}`)
	matches := re.FindAllStringSubmatch(prompd.Content, -1)
	
	for _, match := range matches {
		varName := match[1]
		if !variables[varName] && varName != "inputs" {
			return fmt.Errorf("undefined variable referenced: %s", varName)
		}
	}

	return nil
}

func validateDefaultType(paramName, paramType string, defaultValue interface{}) error {
	switch paramType {
	case "string":
		if _, ok := defaultValue.(string); !ok {
			return fmt.Errorf("default value for parameter '%s' must be a string", paramName)
		}
	case "integer":
		switch v := defaultValue.(type) {
		case int, int32, int64:
			// Valid integer types
		case float64:
			// Check if it's a whole number
			if v != float64(int(v)) {
				return fmt.Errorf("default value for parameter '%s' must be an integer", paramName)
			}
		default:
			return fmt.Errorf("default value for parameter '%s' must be an integer", paramName)
		}
	case "float":
		switch defaultValue.(type) {
		case float32, float64, int, int32, int64:
			// Valid numeric types
		default:
			return fmt.Errorf("default value for parameter '%s' must be a float", paramName)
		}
	case "boolean":
		if _, ok := defaultValue.(bool); !ok {
			return fmt.Errorf("default value for parameter '%s' must be a boolean", paramName)
		}
	case "array":
		switch defaultValue.(type) {
		case []interface{}, []string, []int, []float64:
			// Valid array types
		default:
			return fmt.Errorf("default value for parameter '%s' must be an array", paramName)
		}
	case "object":
		if _, ok := defaultValue.(map[string]interface{}); !ok {
			return fmt.Errorf("default value for parameter '%s' must be an object", paramName)
		}
	}
	return nil
}

func listFiles(path string) error {
	fmt.Printf("Prompd files in %s:\n\n", path)
	
	err := filepath.WalkDir(path, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		
		if !d.IsDir() && strings.HasSuffix(path, ".prompd") {
			// Try to parse the file to get metadata
			prompd, parseErr := parsePrompdFile(path)
			if parseErr != nil {
				fmt.Printf("  ❌ %s (parse error)\n", path)
				return nil
			}
			
			name := prompd.Metadata.Name
			if name == "" {
				name = filepath.Base(path)
			}
			
			desc := prompd.Metadata.Description
			if len(desc) > 50 {
				desc = desc[:47] + "..."
			}
			
			fmt.Printf("  📄 %s\n", name)
			fmt.Printf("     File: %s\n", path)
			if desc != "" {
				fmt.Printf("     Desc: %s\n", desc)
			}
			if prompd.Metadata.Version != "" {
				fmt.Printf("     Ver:  %s\n", prompd.Metadata.Version)
			}
			fmt.Println()
		}
		
		return nil
	})
	
	return err
}

func showFile(filename string) error {
	prompd, err := parsePrompdFile(filename)
	if err != nil {
		return err
	}

	metadata := prompd.Metadata
	
	fmt.Printf("=== %s ===\n", metadata.Name)
	if metadata.Version != "" {
		fmt.Printf("Version: %s\n", metadata.Version)
	}
	
	if metadata.Description != "" {
		fmt.Printf("\nDescription:\n  %s\n", metadata.Description)
	}
	
	allParams := append(metadata.Parameters, metadata.Variables...)
	if len(allParams) > 0 {
		fmt.Println("\nParameters:")
		for _, param := range allParams {
			required := ""
			if param.Required {
				required = " (required)"
			}
			
			fmt.Printf("  • %s (%s)%s\n", param.Name, param.Type, required)
			if param.Description != "" {
				fmt.Printf("    %s\n", param.Description)
			}
			if param.Default != nil {
				fmt.Printf("    Default: %v\n", param.Default)
			}
		}
	}
	
	if len(metadata.Requires) > 0 {
		fmt.Printf("\nRequires: %s\n", strings.Join(metadata.Requires, ", "))
	}
	
	return nil
}

func executeFile(filename string, args []string) error {
	// Check if --demo flag is present for demo mode
	for _, arg := range args {
		if arg == "--demo" {
			return executeFileDemo(filename, args)
		}
	}
	
	// Use enhanced version with real LLM calls
	return executeFileEnhanced(filename, args)
}

func executeFileDemo(filename string, args []string) error {
	prompd, err := parsePrompdFile(filename)
	if err != nil {
		return err
	}

	// Parse command line arguments
	provider := ""
	model := ""
	params := make(map[string]string)
	
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--provider":
			if i+1 < len(args) {
				provider = args[i+1]
				i++
			}
		case "--model":
			if i+1 < len(args) {
				model = args[i+1]
				i++
			}
		case "-p":
			if i+1 < len(args) {
				parts := strings.SplitN(args[i+1], "=", 2)
				if len(parts) == 2 {
					params[parts[0]] = parts[1]
				}
				i++
			}
		}
	}
	
	if provider == "" || model == "" {
		return fmt.Errorf("--provider and --model are required")
	}
	
	// Substitute variables in content
	content := prompd.Content
	for key, value := range params {
		placeholder := fmt.Sprintf("{%s}", key)
		content = strings.ReplaceAll(content, placeholder, value)
	}
	
	fmt.Printf("Executing %s with %s/%s (DEMO MODE)\n\n", filename, provider, model)
	fmt.Println("Processed content:")
	fmt.Println(strings.Repeat("-", 50))
	fmt.Println(content)
	fmt.Println(strings.Repeat("-", 50))
	
	fmt.Println("\n(Demo mode - add --demo to use this mode, otherwise real LLM calls will be made)")
	
	return nil
}

func isValidSemver(version string) bool {
	re := regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)$`)
	return re.MatchString(version)
}