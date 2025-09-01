package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// CompilationStage represents a stage in the compilation pipeline
type CompilationStage string

const (
	LexicalAnalysis     CompilationStage = "lexical_analysis"
	DependencyResolution CompilationStage = "dependency_resolution"
	SemanticAnalysis    CompilationStage = "semantic_analysis"
	AssetExtraction     CompilationStage = "asset_extraction"
	TemplateProcessing  CompilationStage = "template_processing"
	CodeGeneration      CompilationStage = "code_generation"
)

// CompilationContext holds the state during compilation
type CompilationContext struct {
	SourceFile     string                 `json:"source_file"`
	Metadata       map[string]interface{} `json:"metadata"`
	Content        string                 `json:"content"`
	Dependencies   map[string]interface{} `json:"dependencies"`
	Parameters     map[string]interface{} `json:"parameters"`
	Contexts       []string               `json:"contexts"`
	Errors         []string               `json:"errors"`
	Warnings       []string               `json:"warnings"`
	OutputFormat   string                 `json:"output_format"`
	CompiledResult string                 `json:"compiled_result"`
	Verbose        bool                   `json:"verbose"`
}

// CompilerStage interface for pipeline stages
type CompilerStage interface {
	Process(ctx *CompilationContext) error
	GetName() string
}

// LexicalAnalysisStage parses YAML frontmatter + Markdown content
type LexicalAnalysisStage struct{}

func (s *LexicalAnalysisStage) Process(ctx *CompilationContext) error {
	// Parse YAML frontmatter and content using existing function
	parsed, err := parsePrompdFile(ctx.SourceFile)
	if err != nil {
		return fmt.Errorf("failed to parse file: %v", err)
	}

	// Convert PrompdMetadata to map[string]interface{} for compatibility
	metadataBytes, err := yaml.Marshal(parsed.Metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %v", err)
	}
	
	var metadataMap map[string]interface{}
	if err := yaml.Unmarshal(metadataBytes, &metadataMap); err != nil {
		return fmt.Errorf("failed to unmarshal metadata: %v", err)
	}

	ctx.Metadata = metadataMap
	ctx.Content = parsed.Content
	
	// Auto-generate ID from name if missing
	if ctx.Metadata != nil {
		if _, hasID := ctx.Metadata["id"]; !hasID {
			if name, hasName := ctx.Metadata["name"].(string); hasName {
				// Convert name to kebab-case
				re := regexp.MustCompile(`[^a-z0-9]+`)
				id := re.ReplaceAllString(strings.ToLower(name), "-")
				id = strings.Trim(id, "-")
				ctx.Metadata["id"] = id
			}
		}
	}

	if ctx.Verbose {
		fmt.Printf("OK Lexical Analysis completed\n")
	}
	return nil
}

func (s *LexicalAnalysisStage) GetName() string {
	return "Lexical Analysis"
}

// DependencyResolutionStage resolves package dependencies and inheritance
type DependencyResolutionStage struct{}

func (s *DependencyResolutionStage) Process(ctx *CompilationContext) error {
	if ctx.Dependencies == nil {
		ctx.Dependencies = make(map[string]interface{})
	}
	
	if ctx.Metadata == nil {
		return nil
	}

	// Process 'using' field (package imports)
	if using, exists := ctx.Metadata["using"]; exists {
		resolved := make(map[string]interface{})
		
		switch usingVal := using.(type) {
		case string:
			// Single package reference without prefix
			packagePath, err := s.resolvePackage(usingVal)
			if err != nil {
				ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Failed to resolve package %s: %v", usingVal, err))
			} else {
				resolved[usingVal] = map[string]interface{}{
					"path": packagePath,
					"prefix": nil,
				}
				if ctx.Verbose {
					fmt.Printf("OK Resolved package: %s -> %s\n", usingVal, packagePath)
				}
			}
		case []interface{}:
			// Multiple package references (can be strings or maps with prefix)
			for _, pkg := range usingVal {
				switch pkgVal := pkg.(type) {
				case string:
					// Simple string without prefix
					packagePath, err := s.resolvePackage(pkgVal)
					if err != nil {
						ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Failed to resolve package %s: %v", pkgVal, err))
					} else {
						resolved[pkgVal] = map[string]interface{}{
							"path": packagePath,
							"prefix": nil,
						}
						if ctx.Verbose {
							fmt.Printf("OK Resolved package: %s -> %s\n", pkgVal, packagePath)
						}
					}
				case map[string]interface{}:
					// Map with name and optional prefix
					var packageRef string
					var prefix string
					
					if name, ok := pkgVal["name"].(string); ok {
						packageRef = name
					} else if pkgName, ok := pkgVal["package"].(string); ok {
						packageRef = pkgName
					}
					
					if p, ok := pkgVal["prefix"].(string); ok {
						prefix = p
					}
					
					if packageRef != "" {
						packagePath, err := s.resolvePackage(packageRef)
						if err != nil {
							ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Failed to resolve package %s: %v", packageRef, err))
						} else {
							resolved[packageRef] = map[string]interface{}{
								"path": packagePath,
								"prefix": prefix,
							}
							if ctx.Verbose {
								if prefix != "" {
									fmt.Printf("OK Resolved package: %s -> %s (prefix: %s)\n", packageRef, packagePath, prefix)
								} else {
									fmt.Printf("OK Resolved package: %s -> %s\n", packageRef, packagePath)
								}
							}
						}
					}
				}
			}
		}
		
		ctx.Dependencies["imports"] = resolved
	}

	// Process 'inherits' field
	if inherits, exists := ctx.Metadata["inherits"].(string); exists {
		// Check if it's a local file path (contains .prompd or starts with . or /)
		if strings.Contains(inherits, ".prompd") || strings.HasPrefix(inherits, "./") || strings.HasPrefix(inherits, "../") || strings.HasPrefix(inherits, "/") {
			// Local file path - resolve relative to source file
			var sourceDir string
			if ctx.SourceFile != "" {
				sourceDir = filepath.Dir(ctx.SourceFile)
			} else {
				sourceDir, _ = os.Getwd()
			}
			
			parentPath := filepath.Join(sourceDir, inherits)
			resolvedPath, err := filepath.Abs(parentPath)
			if err != nil {
				ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Failed to resolve inheritance path %s: %v", inherits, err))
			} else {
				ctx.Dependencies["inherits"] = resolvedPath
				if ctx.Verbose {
					fmt.Printf("OK Resolved inheritance file: %s -> %s\n", inherits, resolvedPath)
				}
			}
		} else {
			// Package reference - resolve through registry system
			packagePath, err := s.resolvePackage(inherits)
			if err != nil {
				ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Failed to resolve inheritance %s: %v", inherits, err))
			} else {
				ctx.Dependencies["inherits"] = packagePath
				if ctx.Verbose {
					fmt.Printf("OK Resolved inheritance package: %s -> %s\n", inherits, packagePath)
				}
			}
		}
	}

	if ctx.Verbose {
		fmt.Printf("OK Dependency Resolution completed\n")
	}
	return nil
}

func (s *DependencyResolutionStage) resolvePackage(packageRef string) (string, error) {
	// Use the global package resolver for full registry discovery and caching
	return globalPackageResolver.ResolvePackage(packageRef)
}

func (s *DependencyResolutionStage) GetName() string {
	return "Dependency Resolution"
}

// SemanticAnalysisStage validates parameters and references
type SemanticAnalysisStage struct{}

func (s *SemanticAnalysisStage) Process(ctx *CompilationContext) error {
	if ctx.Metadata == nil {
		return nil
	}

	// Validate required parameters are provided
	if params, exists := ctx.Metadata["parameters"]; exists {
		if paramList, ok := params.([]interface{}); ok {
			for _, param := range paramList {
				if paramMap, ok := param.(map[string]interface{}); ok {
					if name, hasName := paramMap["name"].(string); hasName {
						if required, isRequired := paramMap["required"].(bool); isRequired && required {
							if _, hasParam := ctx.Parameters[name]; !hasParam {
								ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Required parameter '%s' not provided", name))
							}
						}
					}
				}
			}
		}
	}

	if ctx.Verbose {
		fmt.Printf("OK Semantic Analysis completed\n")
	}
	return nil
}

func (s *SemanticAnalysisStage) GetName() string {
	return "Semantic Analysis"
}

// AssetExtractionStage extracts content from context files
type AssetExtractionStage struct{}

func (s *AssetExtractionStage) Process(ctx *CompilationContext) error {
	if ctx.Metadata == nil {
		return nil
	}

	// Process context files from metadata
	if context, exists := ctx.Metadata["context"]; exists {
		var contextFiles []string
		
		switch contextVal := context.(type) {
		case string:
			contextFiles = append(contextFiles, contextVal)
		case []interface{}:
			for _, file := range contextVal {
				if fileStr, ok := file.(string); ok {
					contextFiles = append(contextFiles, fileStr)
				}
			}
		}

		// Extract content from each context file
		for _, ctxFile := range contextFiles {
			// Resolve relative paths relative to source file
			if !filepath.IsAbs(ctxFile) {
				ctxFile = filepath.Join(filepath.Dir(ctx.SourceFile), ctxFile)
			}

			if _, err := os.Stat(ctxFile); err == nil {
				extractedContent, err := s.extractContent(ctxFile)
				if err != nil {
					ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Failed to extract content from %s: %v", ctxFile, err))
					ctx.Contexts = append(ctx.Contexts, fmt.Sprintf("## Context from %s\n\n# Extraction failed: %v", filepath.Base(ctxFile), err))
				} else {
					ctx.Contexts = append(ctx.Contexts, fmt.Sprintf("## Context from %s\n\n%s", filepath.Base(ctxFile), extractedContent))
				}
			} else {
				ctx.Warnings = append(ctx.Warnings, fmt.Sprintf("Context file not found: %s", ctxFile))
				ctx.Contexts = append(ctx.Contexts, fmt.Sprintf("## Context from %s\n\n# File not found: %s", filepath.Base(ctxFile), ctxFile))
			}
		}
	}

	if ctx.Verbose {
		fmt.Printf("OK Asset Extraction completed\n")
	}
	return nil
}

func (s *AssetExtractionStage) extractContent(filePath string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	
	switch ext {
	case ".csv":
		return s.extractCSV(filePath)
	case ".json":
		return s.extractJSON(filePath)
	case ".yaml", ".yml":
		return s.extractYAML(filePath)
	case ".txt", ".md":
		return s.extractText(filePath)
	default:
		// For other file types, just read as text
		return s.extractText(filePath)
	}
}

func (s *AssetExtractionStage) extractCSV(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	
	// Format as CSV with syntax highlighting
	return fmt.Sprintf("# %s\n\n```csv\n%s\n```", filepath.Base(filePath), string(content)), nil
}

func (s *AssetExtractionStage) extractJSON(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	
	// Pretty format JSON
	var jsonData interface{}
	if err := json.Unmarshal(content, &jsonData); err != nil {
		return "", err
	}
	
	prettyJSON, err := json.MarshalIndent(jsonData, "", "  ")
	if err != nil {
		return "", err
	}
	
	return fmt.Sprintf("# %s\n\n```json\n%s\n```", filepath.Base(filePath), string(prettyJSON)), nil
}

func (s *AssetExtractionStage) extractYAML(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	
	return fmt.Sprintf("# %s\n\n```yaml\n%s\n```", filepath.Base(filePath), string(content)), nil
}

func (s *AssetExtractionStage) extractText(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	
	return fmt.Sprintf("# %s\n\n```\n%s\n```", filepath.Base(filePath), string(content)), nil
}

func (s *AssetExtractionStage) GetName() string {
	return "Asset Extraction"
}

// TemplateProcessingStage processes template variables, package references, and inheritance
type TemplateProcessingStage struct{}

func (s *TemplateProcessingStage) Process(ctx *CompilationContext) error {
	if ctx.Content == "" {
		return nil
	}

	content := ctx.Content
	
	// Process package references with prefixes (e.g., @security/prompts/audit)
	if imports, ok := ctx.Dependencies["imports"].(map[string]interface{}); ok {
		for _, packageInfo := range imports {
			if info, ok := packageInfo.(map[string]interface{}); ok {
				prefix, _ := info["prefix"].(string)
				packagePath, _ := info["path"].(string)
				
				if prefix != "" && packagePath != "" {
					// Replace references like @security/prompts/audit with actual content
					pattern := regexp.MustCompile(`@` + regexp.QuoteMeta(prefix) + `/([^\s]+)`)
					
					content = pattern.ReplaceAllStringFunc(content, func(match string) string {
						// Extract resource path
						parts := strings.SplitN(match, "/", 2)
						if len(parts) < 2 {
							return match
						}
						resourcePath := parts[1]
						
						// Try to load the file from the package
						possibleFiles := []string{
							filepath.Join(packagePath, resourcePath),
							filepath.Join(packagePath, resourcePath+".prompd"),
							filepath.Join(packagePath, resourcePath+".md"),
							filepath.Join(packagePath, resourcePath+".txt"),
						}
						
						for _, filePath := range possibleFiles {
							if data, err := os.ReadFile(filePath); err == nil {
								// If it's a .prompd file, parse and extract content
								if strings.HasSuffix(filePath, ".prompd") {
									if parsed, err := parsePrompdFile(filePath); err == nil {
										return parsed.Content
									}
								}
								// For other files, return as-is
								return string(data)
							}
						}
						
						// File not found
						if ctx.Verbose {
							fmt.Printf("Warning: Could not find @%s/%s in %s\n", prefix, resourcePath, packagePath)
						}
						return fmt.Sprintf("[Not found: @%s/%s]", prefix, resourcePath)
					})
				}
			}
		}
	}
	
	// Process inheritance - load and merge parent content
	if inheritsPath, ok := ctx.Dependencies["inherits"].(string); ok && inheritsPath != "" {
		var parentFile string
		
		// Check if it's a direct file path or a package directory
		if filepath.Ext(inheritsPath) == ".prompd" {
			// Direct file path
			parentFile = inheritsPath
		} else {
			// Package directory - find main .prompd file
			matches, _ := filepath.Glob(filepath.Join(inheritsPath, "*.prompd"))
			
			for _, file := range matches {
				if filepath.Base(file) == "main.prompd" {
					parentFile = file
					break
				}
			}
			if parentFile == "" && len(matches) > 0 {
				parentFile = matches[0]
			}
		}
		
		if parentFile != "" {
			if parentData, err := parsePrompdFile(parentFile); err == nil {
				// Merge parent content with child content (parent sections first)
				if parentData.Content != "" {
					if ctx.Content != "" {
						// Combine parent content + child content
						ctx.Content = parentData.Content + "\n\n" + ctx.Content
					} else {
						// Use parent content if child has no content
						ctx.Content = parentData.Content
					}
					content = ctx.Content
				}
				
				// Merge parent parameters (child parameters override)
				if len(parentData.Metadata.Parameters) > 0 {
					// Get current parameters as map for quick lookup
					childParams := make(map[string]bool)
					if params, exists := ctx.Metadata["parameters"]; exists {
						if paramList, ok := params.([]interface{}); ok {
							for _, param := range paramList {
								if paramMap, ok := param.(map[string]interface{}); ok {
									if name, hasName := paramMap["name"].(string); hasName {
										childParams[name] = true
									}
								}
							}
						}
					}
					
					// Add parent parameters that don't exist in child
					var updatedParams []interface{}
					if params, exists := ctx.Metadata["parameters"]; exists {
						if paramList, ok := params.([]interface{}); ok {
							updatedParams = paramList
						}
					}
					
					for _, parentParam := range parentData.Metadata.Parameters {
						if !childParams[parentParam.Name] {
							// Convert parent parameter to interface{} format
							paramMap := map[string]interface{}{
								"name":        parentParam.Name,
								"type":        parentParam.Type,
								"description": parentParam.Description,
								"required":    parentParam.Required,
							}
							if parentParam.Default != nil {
								paramMap["default"] = parentParam.Default
							}
							if parentParam.Pattern != "" {
								paramMap["pattern"] = parentParam.Pattern
							}
							updatedParams = append(updatedParams, paramMap)
						}
					}
					
					ctx.Metadata["parameters"] = updatedParams
				}
				
				if ctx.Verbose {
					fmt.Printf("OK Template inherits from: %s (loaded %s)\n", inheritsPath, filepath.Base(parentFile))
				}
			} else if ctx.Verbose {
				fmt.Printf("Warning: Could not inherit from %s: %v\n", inheritsPath, err)
			}
		}
	}
	
	// Simple variable substitution - {variable}
	for key, value := range ctx.Parameters {
		placeholder := fmt.Sprintf("{%s}", key)
		content = strings.ReplaceAll(content, placeholder, fmt.Sprintf("%v", value))
	}

	ctx.Content = content

	if ctx.Verbose {
		fmt.Printf("OK Template Processing completed\n")
	}
	return nil
}

func (s *TemplateProcessingStage) GetName() string {
	return "Template Processing"
}

// CodeGenerationStage generates output in the target format
type CodeGenerationStage struct {
	Formatters map[string]OutputFormatter
}

func NewCodeGenerationStage() *CodeGenerationStage {
	stage := &CodeGenerationStage{
		Formatters: make(map[string]OutputFormatter),
	}
	
	// Register default formatters
	stage.RegisterFormatter("markdown", &MarkdownFormatter{})
	stage.RegisterFormatter("openai", &OpenAIFormatter{})
	stage.RegisterFormatter("anthropic", &AnthropicFormatter{})
	
	return stage
}

func (s *CodeGenerationStage) RegisterFormatter(name string, formatter OutputFormatter) {
	s.Formatters[name] = formatter
}

func (s *CodeGenerationStage) Process(ctx *CompilationContext) error {
	formatName := ctx.OutputFormat
	
	// Handle --to-markdown as just "markdown"
	if strings.HasPrefix(formatName, "to-") {
		formatName = formatName[3:]
	}
	
	formatter, exists := s.Formatters[formatName]
	if !exists {
		return fmt.Errorf("unknown output format: %s", formatName)
	}

	compiled := &CompiledPrompt{
		Metadata:   ctx.Metadata,
		Content:    ctx.Content,
		Contexts:   ctx.Contexts,
		Parameters: ctx.Parameters,
	}

	result, err := formatter.Format(compiled)
	if err != nil {
		return fmt.Errorf("code generation failed: %v", err)
	}

	ctx.CompiledResult = result

	if ctx.Verbose {
		fmt.Printf("OK Code Generation completed\n")
	}
	return nil
}

func (s *CodeGenerationStage) GetName() string {
	return "Code Generation"
}

// CompiledPrompt represents a compiled prompt ready for formatting
type CompiledPrompt struct {
	Metadata   map[string]interface{} `json:"metadata"`
	Content    string                 `json:"content"`
	Contexts   []string               `json:"contexts"`
	Parameters map[string]interface{} `json:"parameters"`
}

// OutputFormatter interface for output format plugins
type OutputFormatter interface {
	Format(compiled *CompiledPrompt) (string, error)
}

// MarkdownFormatter formats as human-readable markdown
type MarkdownFormatter struct{}

func (f *MarkdownFormatter) Format(compiled *CompiledPrompt) (string, error) {
	var output strings.Builder
	
	// Add metadata as YAML frontmatter comment
	if compiled.Metadata != nil {
		output.WriteString("<!-- PROMPD METADATA\n")
		metadataYAML, err := yaml.Marshal(compiled.Metadata)
		if err != nil {
			return "", err
		}
		output.WriteString(string(metadataYAML))
		output.WriteString("-->\n\n")
	}
	
	// Add extracted contexts as sections
	if len(compiled.Contexts) > 0 {
		output.WriteString("# Extracted Context Files\n\n")
		for _, ctx := range compiled.Contexts {
			output.WriteString(ctx)
			output.WriteString("\n\n")
		}
	}
	
	// Add main content
	if compiled.Content != "" {
		output.WriteString("# Main Prompt Content\n\n")
		output.WriteString(compiled.Content)
	}
	
	return output.String(), nil
}

// OpenAIFormatter formats for OpenAI API
type OpenAIFormatter struct{}

func (f *OpenAIFormatter) Format(compiled *CompiledPrompt) (string, error) {
	messages := []map[string]interface{}{
		{
			"role":    "user",
			"content": compiled.Content,
		},
	}
	
	apiRequest := map[string]interface{}{
		"model":       "gpt-4",
		"messages":    messages,
		"temperature": 0.1,
	}
	
	result, err := json.MarshalIndent(apiRequest, "", "  ")
	if err != nil {
		return "", err
	}
	
	return string(result), nil
}

// AnthropicFormatter formats for Anthropic Claude API
type AnthropicFormatter struct{}

func (f *AnthropicFormatter) Format(compiled *CompiledPrompt) (string, error) {
	apiRequest := map[string]interface{}{
		"model":  "claude-3-sonnet-20240229",
		"system": nil,
		"messages": []map[string]interface{}{
			{
				"role":    "user",
				"content": compiled.Content,
			},
		},
	}
	
	result, err := json.MarshalIndent(apiRequest, "", "  ")
	if err != nil {
		return "", err
	}
	
	return string(result), nil
}

// CompilerPipeline orchestrates the compilation process
type CompilerPipeline struct {
	Stages []CompilerStage
}

func NewCompilerPipeline() *CompilerPipeline {
	return &CompilerPipeline{
		Stages: []CompilerStage{
			&LexicalAnalysisStage{},
			&DependencyResolutionStage{},
			&SemanticAnalysisStage{},
			&AssetExtractionStage{},
			&TemplateProcessingStage{},
			NewCodeGenerationStage(),
		},
	}
}

func (p *CompilerPipeline) Execute(sourcePath, outputFormat string, parameters map[string]interface{}, verbose bool) (*CompilationContext, error) {
	ctx := &CompilationContext{
		SourceFile:     sourcePath,
		OutputFormat:   outputFormat,
		Parameters:     parameters,
		Dependencies:   make(map[string]interface{}),
		Contexts:       []string{},
		Errors:         []string{},
		Warnings:       []string{},
		Verbose:        verbose,
	}

	// Run each stage
	for _, stage := range p.Stages {
		if len(ctx.Errors) > 0 {
			break // Stop on first error
		}
		
		if err := stage.Process(ctx); err != nil {
			ctx.Errors = append(ctx.Errors, fmt.Sprintf("%s failed: %v", stage.GetName(), err))
		}
	}

	return ctx, nil
}

// PrompDCompiler is the high-level compiler interface
type PrompDCompiler struct {
	Pipeline *CompilerPipeline
}

func NewPrompDCompiler() *PrompDCompiler {
	return &PrompDCompiler{
		Pipeline: NewCompilerPipeline(),
	}
}

func (c *PrompDCompiler) Compile(sourcePath, outputFormat string, parameters map[string]interface{}, outputFile string, verbose bool) (string, error) {
	ctx, err := c.Pipeline.Execute(sourcePath, outputFormat, parameters, verbose)
	if err != nil {
		return "", err
	}

	if len(ctx.Errors) > 0 {
		return "", fmt.Errorf("compilation failed: %s", strings.Join(ctx.Errors, ", "))
	}

	// Print warnings
	for _, warning := range ctx.Warnings {
		fmt.Printf("Warning: %s\n", warning)
	}

	// Save to output file if specified
	if outputFile != "" && ctx.CompiledResult != "" {
		if err := os.WriteFile(outputFile, []byte(ctx.CompiledResult), 0644); err != nil {
			return "", fmt.Errorf("failed to write output file: %v", err)
		}
	}

	return ctx.CompiledResult, nil
}