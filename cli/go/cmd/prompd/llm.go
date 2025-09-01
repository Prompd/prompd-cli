package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type LLMRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	Temperature float64   `json:"temperature,omitempty"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type LLMResponse struct {
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage,omitempty"`
}

type Choice struct {
	Message Message `json:"message"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// Enhanced execute function with real LLM integration
func executeFileEnhanced(filename string, args []string) error {
	prompd, err := parsePrompdFile(filename)
	if err != nil {
		return err
	}

	// Load config
	config, err := LoadConfig()
	if err != nil {
		// Continue without config if loading fails
		config = &Config{
			APIKeys:         make(map[string]string),
			CustomProviders: make(map[string]CustomProvider),
		}
	}

	// Parse command line arguments
	provider := ""
	model := ""
	apiKey := ""
	output := ""
	verbose := false
	showUsage := false
	paramsFile := ""
	format := ""
	params := make(map[string]interface{})
	metaSystem := ""
	metaContext := ""
	metaUser := ""
	
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
		case "--api-key":
			if i+1 < len(args) {
				apiKey = args[i+1]
				i++
			}
		case "--output", "-o":
			if i+1 < len(args) {
				output = args[i+1]
				i++
			}
		case "--params":
			if i+1 < len(args) {
				paramsFile = args[i+1]
				i++
			}
		case "--format":
			if i+1 < len(args) {
				format = args[i+1]
				i++
			}
		case "--verbose", "-v":
			verbose = true
		case "--show-usage":
			showUsage = true
		case "-p":
			if i+1 < len(args) {
				parts := strings.SplitN(args[i+1], "=", 2)
				if len(parts) == 2 {
					params[parts[0]] = parts[1]
				}
				i++
			}
		case "--meta-system":
			if i+1 < len(args) {
				metaSystem = args[i+1]
				i++
			}
		case "--meta-context":
			if i+1 < len(args) {
				metaContext = args[i+1]
				i++
			}
		case "--meta-user":
			if i+1 < len(args) {
				metaUser = args[i+1]
				i++
			}
		}
	}
	
	// Load parameters from file if specified
	if paramsFile != "" {
		fileParams, err := loadParametersFromFile(paramsFile)
		if err != nil {
			return fmt.Errorf("failed to load parameters file: %w", err)
		}
		
		// Merge file parameters with command line parameters (CLI takes precedence)
		for k, v := range fileParams {
			if _, exists := params[k]; !exists {
				params[k] = v
			}
		}
	}
	
	// Use config defaults if not specified
	if provider == "" {
		provider = config.GetDefaultProvider()
	}
	if model == "" {
		model = config.GetDefaultModel(provider)
	}
	
	if provider == "" || model == "" {
		return fmt.Errorf("--provider and --model are required (or set defaults in config)")
	}
	
	// Get API key from config if not provided via command line
	if apiKey == "" {
		apiKey = config.GetAPIKey(provider)
	}
	
	// Merge all parameter definitions (parameters and variables for backward compatibility)
	allParams := append(prompd.Metadata.Parameters, prompd.Metadata.Variables...)
	
	// Validate parameters
	for _, param := range allParams {
		value, exists := params[param.Name]
		
		// Check required parameters
		if param.Required && !exists {
			return fmt.Errorf("required parameter missing: %s", param.Name)
		}
		
		// Apply default value if parameter not provided
		if !exists && param.Default != nil {
			params[param.Name] = param.Default
			value = param.Default
		}
		
		// Skip validation if parameter not provided and not required
		if !exists {
			continue
		}
		
		// Validate parameter value
		if err := validateParameterValue(param, value); err != nil {
			return fmt.Errorf("parameter '%s' validation failed: %w", param.Name, err)
		}
	}
	
	// Apply metadata overrides if provided
	systemSection := extractSectionContent(prompd.Content, "system")
	contextSection := extractSectionContent(prompd.Content, "context")
	userSection := extractSectionContent(prompd.Content, "user")
	
	// Override with command line values
	if metaSystem != "" {
		systemSection = resolveMetadataValue(metaSystem, filename, verbose)
	}
	if metaContext != "" {
		contextSection = resolveMetadataValue(metaContext, filename, verbose)
	}
	if metaUser != "" {
		userSection = resolveMetadataValue(metaUser, filename, verbose)
	}
	
	// Reconstruct content with overrides
	overriddenContent := reconstructContentWithOverrides(prompd.Content, systemSection, contextSection, userSection)
	
	// Apply template processing (variable substitution + basic conditionals)
	content := processTemplate(overriddenContent, params)
	
	if verbose {
		fmt.Printf("Executing %s with %s/%s\n", filename, provider, model)
		fmt.Printf("Parameters: %v\n", params)
		fmt.Println()
	}
	
	// Execute with LLM
	response, err := callLLM(provider, model, content, apiKey)
	if err != nil {
		return fmt.Errorf("LLM call failed: %w", err)
	}
	
	// Output result based on format
	if format == "json" {
		// JSON output for programmatic use
		result := map[string]interface{}{
			"response": response.Content,
			"provider": provider,
			"model":    model,
		}
		if response.Usage != nil {
			result["usage"] = response.Usage
		}
		
		resultBytes, _ := json.Marshal(result)
		if output != "" {
			if err := os.WriteFile(output, resultBytes, 0644); err != nil {
				return fmt.Errorf("failed to write output file: %w", err)
			}
			fmt.Printf("✓ JSON response written to %s\n", output)
		} else {
			fmt.Println(string(resultBytes))
		}
	} else {
		// Human-readable output
		if output != "" {
			if err := os.WriteFile(output, []byte(response.Content), 0644); err != nil {
				return fmt.Errorf("failed to write output file: %w", err)
			}
			fmt.Printf("✓ Response written to %s\n", output)
		} else {
			fmt.Println("Response:")
			fmt.Println(strings.Repeat("-", 50))
			fmt.Println(response.Content)
			fmt.Println(strings.Repeat("-", 50))
		}
	}
	
	if (verbose || showUsage) && response.Usage != nil {
		fmt.Printf("\nUsage: %d prompt + %d completion = %d total tokens\n", 
			response.Usage.PromptTokens, 
			response.Usage.CompletionTokens, 
			response.Usage.TotalTokens)
	}
	
	return nil
}

type LLMResult struct {
	Content string
	Usage   *Usage
}

func validateParameterValue(param Parameter, value interface{}) error {
	// Type validation
	switch param.Type {
	case "string":
		strValue, ok := value.(string)
		if !ok {
			return fmt.Errorf("expected string, got %T", value)
		}
		
		// Pattern validation
		if param.Pattern != "" {
			matched, err := regexp.MatchString(param.Pattern, strValue)
			if err != nil {
				return fmt.Errorf("invalid pattern: %w", err)
			}
			if !matched {
				return fmt.Errorf("value '%s' does not match pattern '%s'", strValue, param.Pattern)
			}
		}
		
	case "integer":
		var intValue int64
		switch v := value.(type) {
		case int:
			intValue = int64(v)
		case int32:
			intValue = int64(v)
		case int64:
			intValue = v
		case float64:
			if v != float64(int64(v)) {
				return fmt.Errorf("expected integer, got float with decimal")
			}
			intValue = int64(v)
		case string:
			parsed, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return fmt.Errorf("cannot parse '%s' as integer", v)
			}
			intValue = parsed
		default:
			return fmt.Errorf("expected integer, got %T", value)
		}
		
		// Range validation
		if param.Min != nil && float64(intValue) < *param.Min {
			return fmt.Errorf("value %d is less than minimum %v", intValue, *param.Min)
		}
		if param.Max != nil && float64(intValue) > *param.Max {
			return fmt.Errorf("value %d is greater than maximum %v", intValue, *param.Max)
		}
		
	case "float":
		var floatValue float64
		switch v := value.(type) {
		case float32:
			floatValue = float64(v)
		case float64:
			floatValue = v
		case int:
			floatValue = float64(v)
		case int32:
			floatValue = float64(v)
		case int64:
			floatValue = float64(v)
		case string:
			parsed, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return fmt.Errorf("cannot parse '%s' as float", v)
			}
			floatValue = parsed
		default:
			return fmt.Errorf("expected float, got %T", value)
		}
		
		// Range validation
		if param.Min != nil && floatValue < *param.Min {
			return fmt.Errorf("value %v is less than minimum %v", floatValue, *param.Min)
		}
		if param.Max != nil && floatValue > *param.Max {
			return fmt.Errorf("value %v is greater than maximum %v", floatValue, *param.Max)
		}
		
	case "boolean":
		switch v := value.(type) {
		case bool:
			// Valid boolean
		case string:
			if v != "true" && v != "false" {
				return fmt.Errorf("cannot parse '%s' as boolean", v)
			}
		default:
			return fmt.Errorf("expected boolean, got %T", value)
		}
		
	case "array":
		switch value.(type) {
		case []interface{}, []string, []int, []float64:
			// Valid array types
		default:
			return fmt.Errorf("expected array, got %T", value)
		}
		
	case "object":
		switch value.(type) {
		case map[string]interface{}:
			// Valid object type
		default:
			return fmt.Errorf("expected object, got %T", value)
		}
	}
	
	return nil
}

func processTemplate(content string, params map[string]interface{}) string {
	// First, handle simple variable substitution
	for key, value := range params {
		placeholder := fmt.Sprintf("{%s}", key)
		var valueStr string
		if v, ok := value.(string); ok {
			valueStr = v
		} else {
			valueStr = fmt.Sprintf("%v", value)
		}
		content = strings.ReplaceAll(content, placeholder, valueStr)
	}
	
	// Handle basic conditionals: {%- if condition %}...{%- endif %}
	conditionalRegex := regexp.MustCompile(`\{%- if ([^}]+) %\}(.*?)\{%- endif %\}`)
	content = conditionalRegex.ReplaceAllStringFunc(content, func(match string) string {
		matches := conditionalRegex.FindStringSubmatch(match)
		if len(matches) != 3 {
			return match // Return original if parsing fails
		}
		
		condition := strings.TrimSpace(matches[1])
		contentBlock := matches[2]
		
		if evaluateCondition(condition, params) {
			return contentBlock
		}
		return ""
	})
	
	// Handle if-else conditionals: {%- if condition %}...{%- else %}...{%- endif %}
	ifElseRegex := regexp.MustCompile(`\{%- if ([^}]+) %\}(.*?)\{%- else %\}(.*?)\{%- endif %\}`)
	content = ifElseRegex.ReplaceAllStringFunc(content, func(match string) string {
		matches := ifElseRegex.FindStringSubmatch(match)
		if len(matches) != 4 {
			return match // Return original if parsing fails
		}
		
		condition := strings.TrimSpace(matches[1])
		trueBlock := matches[2]
		falseBlock := matches[3]
		
		if evaluateCondition(condition, params) {
			return trueBlock
		}
		return falseBlock
	})
	
	return content
}

func evaluateCondition(condition string, params map[string]interface{}) bool {
	condition = strings.TrimSpace(condition)
	
	// Handle equality comparisons: variable == "value"
	if strings.Contains(condition, "==") {
		parts := strings.Split(condition, "==")
		if len(parts) == 2 {
			left := strings.TrimSpace(parts[0])
			right := strings.TrimSpace(parts[1])
			
			// Remove quotes from right side if present
			right = strings.Trim(right, `"'`)
			
			// Get value from params
			if value, exists := params[left]; exists {
				valueStr := fmt.Sprintf("%v", value)
				return valueStr == right
			}
			return false
		}
	}
	
	// Handle simple boolean evaluation: if variable (truthy check)
	if value, exists := params[condition]; exists {
		switch v := value.(type) {
		case bool:
			return v
		case string:
			return v != ""
		case int, int32, int64:
			return v != 0
		case float32, float64:
			return v != 0
		default:
			return value != nil
		}
	}
	
	return false
}

func callLLM(provider, model, content, apiKey string) (*LLMResult, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("API key required for provider %s", provider)
	}
	
	switch provider {
	case "openai":
		return callOpenAI(model, content, apiKey)
	case "anthropic":
		return callAnthropic(model, content, apiKey)
	case "ollama":
		return callOllama(model, content)
	default:
		return nil, fmt.Errorf("unsupported provider: %s", provider)
	}
}

func callOpenAI(model, content, apiKey string) (*LLMResult, error) {
	url := "https://api.openai.com/v1/chat/completions"
	
	req := LLMRequest{
		Model: model,
		Messages: []Message{
			{Role: "user", Content: content},
		},
		MaxTokens:   1000,
		Temperature: 0.7,
	}
	
	return makeHTTPRequest(url, req, apiKey, "Bearer")
}

func callAnthropic(model, content, apiKey string) (*LLMResult, error) {
	url := "https://api.anthropic.com/v1/messages"
	
	// Anthropic has a different request format
	reqBody := map[string]interface{}{
		"model":      model,
		"max_tokens": 1000,
		"messages": []map[string]string{
			{"role": "user", "content": content},
		},
	}
	
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}
	
	var response map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}
	
	// Extract content from Anthropic response format
	if content, ok := response["content"].([]interface{}); ok && len(content) > 0 {
		if textContent, ok := content[0].(map[string]interface{}); ok {
			if text, ok := textContent["text"].(string); ok {
				return &LLMResult{Content: text}, nil
			}
		}
	}
	
	return nil, fmt.Errorf("unexpected response format")
}

func callOllama(model, content string) (*LLMResult, error) {
	url := "http://localhost:11434/api/generate"
	
	reqBody := map[string]interface{}{
		"model":  model,
		"prompt": content,
		"stream": false,
	}
	
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	
	client := &http.Client{Timeout: 60 * time.Second}
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Ollama API error %d: %s", resp.StatusCode, string(body))
	}
	
	var response map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}
	
	if responseText, ok := response["response"].(string); ok {
		return &LLMResult{Content: responseText}, nil
	}
	
	return nil, fmt.Errorf("unexpected Ollama response format")
}

func makeHTTPRequest(url string, req LLMRequest, apiKey, authType string) (*LLMResult, error) {
	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", fmt.Sprintf("%s %s", authType, apiKey))
	
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}
	
	var response LLMResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}
	
	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response choices returned")
	}
	
	return &LLMResult{
		Content: response.Choices[0].Message.Content,
		Usage:   &response.Usage,
	}, nil
}

func getAPIKey(provider string) string {
	// Load config and get API key
	config, err := LoadConfig()
	if err != nil {
		// Fallback to environment variables if config loading fails
		return getAPIKeyFromEnv(provider)
	}
	
	return config.GetAPIKey(provider)
}

// loadParametersFromFile loads parameters from a JSON file
func loadParametersFromFile(filename string) (map[string]interface{}, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, err
	}
	
	var params map[string]interface{}
	if err := json.Unmarshal(data, &params); err != nil {
		return nil, fmt.Errorf("failed to parse JSON parameters: %w", err)
	}
	
	return params, nil
}

// extractSectionContent extracts content from a markdown section
func extractSectionContent(content, section string) string {
	lines := strings.Split(content, "\n")
	var result []string
	inSection := false
	sectionHeader := "## " + strings.Title(section)
	
	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			if strings.HasPrefix(line, sectionHeader) {
				inSection = true
				continue
			} else if inSection {
				break
			}
		}
		
		if inSection {
			result = append(result, line)
		}
	}
	
	return strings.Join(result, "\n")
}

// resolveMetadataValue resolves a metadata value from either direct text or file path
func resolveMetadataValue(value, currentFile string, verbose bool) string {
	// Check if it's a file path
	if strings.HasPrefix(value, "./") || strings.HasPrefix(value, "/") || (len(value) > 1 && value[1] == ':') {
		filePath := value
		if strings.HasPrefix(value, "./") {
			// Relative path - resolve relative to current file
			currentDir := filepath.Dir(currentFile)
			filePath = filepath.Join(currentDir, value[2:])
		}
		
		content, err := os.ReadFile(filePath)
		if err != nil {
			fmt.Printf("Error reading file '%s': %v\n", filePath, err)
			return value // Return original value as fallback
		}
		
		if verbose {
			fmt.Printf("Loaded content from %s\n", filePath)
		}
		
		return string(content)
	}
	
	// Direct text content
	return value
}

// reconstructContentWithOverrides reconstructs the content with section overrides
func reconstructContentWithOverrides(originalContent, systemSection, contextSection, userSection string) string {
	lines := strings.Split(originalContent, "\n")
	var result []string
	currentSection := ""
	
	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			sectionName := strings.ToLower(strings.TrimSpace(line[3:]))
			currentSection = sectionName
			
			// Add the header
			result = append(result, line)
			
			// Add override content if available
			switch currentSection {
			case "system":
				if systemSection != "" {
					result = append(result, strings.Split(systemSection, "\n")...)
					currentSection = "skip" // Skip original content
				}
			case "context":
				if contextSection != "" {
					result = append(result, strings.Split(contextSection, "\n")...)
					currentSection = "skip" // Skip original content
				}
			case "user":
				if userSection != "" {
					result = append(result, strings.Split(userSection, "\n")...)
					currentSection = "skip" // Skip original content
				}
			}
		} else if currentSection == "skip" && strings.HasPrefix(line, "## ") {
			// New section found, stop skipping
			currentSection = ""
			result = append(result, line)
		} else if currentSection != "skip" {
			// Add original line if not skipping
			result = append(result, line)
		}
	}
	
	return strings.Join(result, "\n")
}