package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config represents the prompd configuration
type Config struct {
	APIKeys         map[string]string         `yaml:"api_keys"`
	DefaultProvider string                    `yaml:"default_provider"`
	DefaultModel    string                    `yaml:"default_model"`
	CustomProviders map[string]CustomProvider `yaml:"custom_providers"`
	MaxRetries      int                       `yaml:"max_retries"`
	Timeout         int                       `yaml:"timeout"`
	Verbose         bool                      `yaml:"verbose"`
}

// CustomProvider represents a custom LLM provider configuration
type CustomProvider struct {
	APIKey   string   `yaml:"api_key"`
	BaseURL  string   `yaml:"base_url"`
	Enabled  bool     `yaml:"enabled"`
	Models   []string `yaml:"models"`
	Type     string   `yaml:"type"`
}

var globalConfig *Config

// LoadConfig loads configuration from various sources
func LoadConfig() (*Config, error) {
	if globalConfig != nil {
		return globalConfig, nil
	}

	config := &Config{
		APIKeys:         make(map[string]string),
		CustomProviders: make(map[string]CustomProvider),
		MaxRetries:      3,
		Timeout:         30,
		Verbose:         false,
	}

	// Try to load from config files in order of precedence
	configPaths := getConfigPaths()
	
	for _, path := range configPaths {
		if _, err := os.Stat(path); err == nil {
			if err := loadConfigFile(path, config); err != nil {
				fmt.Printf("Warning: Error loading config from %s: %v\n", path, err)
				continue
			}
			fmt.Printf("Loaded config from: %s\n", path)
			break
		}
	}

	// Override with environment variables
	loadEnvironmentVariables(config)

	globalConfig = config
	return config, nil
}

// getConfigPaths returns config file paths in order of precedence
func getConfigPaths() []string {
	var paths []string
	
	// 1. Current directory
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(cwd, ".prompd", "config.yaml"))
		paths = append(paths, filepath.Join(cwd, ".prompd", "config.json"))
	}
	
	// 2. User home directory
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, ".prompd", "config.yaml"))
		paths = append(paths, filepath.Join(home, ".prompd", "config.json"))
	}
	
	// 3. System config directory (Windows)
	if appData := os.Getenv("APPDATA"); appData != "" {
		paths = append(paths, filepath.Join(appData, "prompd", "config.yaml"))
	}
	
	return paths
}

// loadConfigFile loads configuration from a file
func loadConfigFile(path string, config *Config) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	// Support both YAML and JSON
	if strings.HasSuffix(path, ".yaml") || strings.HasSuffix(path, ".yml") {
		return yaml.Unmarshal(data, config)
	} else {
		// For JSON, we can use YAML parser since it's a superset
		return yaml.Unmarshal(data, config)
	}
}

// loadEnvironmentVariables loads config from environment variables
func loadEnvironmentVariables(config *Config) {
	// API keys from environment
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		config.APIKeys["openai"] = key
	}
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		config.APIKeys["anthropic"] = key
	}
	if key := os.Getenv("GROQ_API_KEY"); key != "" {
		config.APIKeys["groq"] = key
	}
	
	// Default provider and model
	if provider := os.Getenv("PROMPD_DEFAULT_PROVIDER"); provider != "" {
		config.DefaultProvider = provider
	}
	if model := os.Getenv("PROMPD_DEFAULT_MODEL"); model != "" {
		config.DefaultModel = model
	}
	
	// Verbose flag
	if os.Getenv("PROMPD_VERBOSE") == "true" {
		config.Verbose = true
	}
}

// GetAPIKey gets API key for a provider from config
func (c *Config) GetAPIKey(provider string) string {
	// First check explicit API keys
	if key, exists := c.APIKeys[provider]; exists && key != "" {
		return key
	}
	
	// Then check custom providers
	if customProvider, exists := c.CustomProviders[provider]; exists {
		if customProvider.APIKey != "" {
			return customProvider.APIKey
		}
	}
	
	// Fallback to environment variables (in case config wasn't loaded)
	return getAPIKeyFromEnv(provider)
}

// getAPIKeyFromEnv gets API key from environment variables (fallback)
func getAPIKeyFromEnv(provider string) string {
	switch provider {
	case "openai":
		return os.Getenv("OPENAI_API_KEY")
	case "anthropic":
		return os.Getenv("ANTHROPIC_API_KEY")
	case "groq":
		return os.Getenv("GROQ_API_KEY")
	default:
		// Try generic pattern: PROVIDER_API_KEY
		envKey := strings.ToUpper(provider) + "_API_KEY"
		return os.Getenv(envKey)
	}
}

// GetDefaultProvider returns the default provider
func (c *Config) GetDefaultProvider() string {
	if c.DefaultProvider != "" {
		return c.DefaultProvider
	}
	return "openai" // fallback
}

// GetDefaultModel returns the default model for a provider
func (c *Config) GetDefaultModel(provider string) string {
	if c.DefaultModel != "" {
		return c.DefaultModel
	}
	
	// Provider-specific defaults
	switch provider {
	case "openai":
		return "gpt-4o-mini"
	case "anthropic":
		return "claude-3-haiku-20240307"
	case "groq":
		return "llama3-8b-8192"
	default:
		return "default"
	}
}

// IsProviderConfigured checks if a provider has required configuration
func (c *Config) IsProviderConfigured(provider string) bool {
	switch provider {
	case "ollama":
		return true // Local provider doesn't need API key
	default:
		return c.GetAPIKey(provider) != ""
	}
}

// ListConfiguredProviders returns a list of properly configured providers
func (c *Config) ListConfiguredProviders() []string {
	providers := []string{}
	
	// Built-in providers
	builtinProviders := []string{"openai", "anthropic", "groq", "ollama"}
	for _, provider := range builtinProviders {
		if c.IsProviderConfigured(provider) {
			providers = append(providers, provider)
		}
	}
	
	// Custom providers
	for name, customProvider := range c.CustomProviders {
		if customProvider.Enabled && customProvider.APIKey != "" {
			providers = append(providers, name)
		}
	}
	
	return providers
}