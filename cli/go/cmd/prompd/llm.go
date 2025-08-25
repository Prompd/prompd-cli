package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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
	paramsFile := ""
	format := ""
	params := make(map[string]interface{})
	
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
	
	// Validate required parameters
	for _, param := range allParams {
		if param.Required {
			if _, ok := params[param.Name]; !ok {
				return fmt.Errorf("required parameter missing: %s", param.Name)
			}
		}
	}
	
	// Substitute variables in content
	content := prompd.Content
	for key, value := range params {
		placeholder := fmt.Sprintf("{%s}", key)
		// Convert value to string for substitution
		var valueStr string
		if v, ok := value.(string); ok {
			valueStr = v
		} else {
			valueStr = fmt.Sprintf("%v", value)
		}
		content = strings.ReplaceAll(content, placeholder, valueStr)
	}
	
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
	
	if verbose && response.Usage != nil {
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