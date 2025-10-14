package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// RegistryConfig represents a single registry configuration
type RegistryInfo struct {
	URL      string `yaml:"url"`
	Token    string `yaml:"token,omitempty"`
	Username string `yaml:"username,omitempty"`
}

// Config represents the prompd configuration
type Config struct {
	APIKeys          map[string]string                `yaml:"api_keys"`
	DefaultProvider  string                           `yaml:"default_provider"`
	DefaultModel     string                           `yaml:"default_model"`
	CustomProviders  map[string]CustomProvider        `yaml:"custom_providers"`
	Registry         map[string]interface{}           `yaml:"registry"`
	Scopes           map[string]string                `yaml:"scopes"`
	Namespaces       map[string]string                `yaml:"namespaces"`
	CurrentNamespace string                           `yaml:"current_namespace"`
	MaxRetries       int                              `yaml:"max_retries"`
	Timeout          int                              `yaml:"timeout"`
	Verbose          bool                             `yaml:"verbose"`
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
		Registry:        make(map[string]interface{}),
		Scopes:          make(map[string]string),
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

	// Ensure default registries and migrate legacy config
	ensureDefaultRegistries(config)
	migrateLegacyConfig(config)

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
		return "claude-3-5-haiku-20241022"
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

// SaveConfig saves the config to the user config file
func SaveConfig(config *Config) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("error getting home directory: %w", err)
	}
	
	configDir := filepath.Join(homeDir, ".prompd")
	configPath := filepath.Join(configDir, "config.yaml")
	
	// Ensure config directory exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("error creating config directory: %w", err)
	}
	
	// Marshal config to YAML
	data, err := yaml.Marshal(config)
	if err != nil {
		return fmt.Errorf("error marshaling config: %w", err)
	}
	
	// Write to file
	if err := ioutil.WriteFile(configPath, data, 0600); err != nil {
		return fmt.Errorf("error writing config file: %w", err)
	}
	
	// Update global config
	globalConfig = config
	
	return nil
}

// Multi-Registry Functions

// ensureDefaultRegistries ensures prompdhub registry is always available
func ensureDefaultRegistries(config *Config) {
	// Initialize registry structure if not exists
	if config.Registry == nil {
		config.Registry = make(map[string]interface{})
	}
	
	// Get registries map or initialize it
	var registries map[string]interface{}
	if reg, exists := config.Registry["registries"]; exists {
		if regMap, ok := reg.(map[string]interface{}); ok {
			registries = regMap
		} else {
			registries = make(map[string]interface{})
		}
	} else {
		registries = make(map[string]interface{})
	}
	
	// Ensure prompdhub is available (unless explicitly removed)
	if _, exists := registries["prompdhub"]; !exists {
		registries["prompdhub"] = map[string]interface{}{
			"url":      "https://registry.prompdhub.ai",
			"token":    nil,
			"username": nil,
		}
	}
	
	config.Registry["registries"] = registries
	
	// Set prompdhub as default if no default is set
	if _, exists := config.Registry["default"]; !exists {
		config.Registry["default"] = "prompdhub"
	}
}

// migrateLegacyConfig migrates old single-registry config to multi-registry
func migrateLegacyConfig(config *Config) {
	// Check for legacy prompd token in api_keys
	if token, exists := config.APIKeys["prompd"]; exists {
		// Move to registry structure
		registries := getRegistriesMap(config)
		
		// If prompdhub doesn't have a token, use the legacy one
		if prompdhub, exists := registries["prompdhub"]; exists {
			if prompdhubMap, ok := prompdhub.(map[string]interface{}); ok {
				if _, hasToken := prompdhubMap["token"]; !hasToken {
					prompdhubMap["token"] = token
				}
			}
		}
		
		// Remove from api_keys
		delete(config.APIKeys, "prompd")
	}
}

// Helper function to get registries map
func getRegistriesMap(config *Config) map[string]interface{} {
	if reg, exists := config.Registry["registries"]; exists {
		if regMap, ok := reg.(map[string]interface{}); ok {
			return regMap
		}
	}
	return make(map[string]interface{})
}

// resolveRegistryForPackage resolves which registry to use for a package
func resolveRegistryForPackage(config *Config, packageName string) string {
	// Extract scope from package name (@scope/package)
	if strings.HasPrefix(packageName, "@") && strings.Contains(packageName, "/") {
		scope := strings.Split(packageName, "/")[0] // @company
		
		// Check if scope has a configured registry
		if registryName, exists := config.Scopes[scope]; exists {
			registries := getRegistriesMap(config)
			if _, registryExists := registries[registryName]; registryExists {
				return registryName
			}
		}
	}
	
	// Fallback to default registry
	if defaultReg, exists := config.Registry["default"]; exists {
		if defaultStr, ok := defaultReg.(string); ok {
			return defaultStr
		}
	}
	
	return "prompdhub"
}

// addRegistry adds a new registry to the configuration
func addRegistry(config *Config, name, url string) error {
	registries := getRegistriesMap(config)
	
	registries[name] = map[string]interface{}{
		"url": url,
	}
	
	config.Registry["registries"] = registries
	
	// Set as default if it's the first registry
	if _, exists := config.Registry["default"]; !exists {
		config.Registry["default"] = name
	}
	
	return SaveConfig(config)
}

// removeRegistry removes a registry from the configuration
func removeRegistry(config *Config, name string) error {
	registries := getRegistriesMap(config)
	
	if _, exists := registries[name]; !exists {
		return fmt.Errorf("registry '%s' not found", name)
	}
	
	delete(registries, name)
	config.Registry["registries"] = registries
	
	// Update default if we removed the default registry
	if defaultReg, exists := config.Registry["default"]; exists {
		if defaultStr, ok := defaultReg.(string); ok && defaultStr == name {
			// Set new default from remaining registries
			for regName := range registries {
				config.Registry["default"] = regName
				break
			}
			// If no registries left, remove default
			if len(registries) == 0 {
				delete(config.Registry, "default")
			}
		}
	}
	
	return SaveConfig(config)
}

// setDefaultRegistry sets the default registry
func setDefaultRegistry(config *Config, name string) error {
	registries := getRegistriesMap(config)
	
	if _, exists := registries[name]; !exists {
		return fmt.Errorf("registry '%s' not found", name)
	}
	
	config.Registry["default"] = name
	
	return SaveConfig(config)
}

// getRegistryInfo gets information about a specific registry
func getRegistryInfo(config *Config, name string) (*RegistryInfo, error) {
	registries := getRegistriesMap(config)
	
	regData, exists := registries[name]
	if !exists {
		return nil, fmt.Errorf("registry '%s' not found", name)
	}
	
	regMap, ok := regData.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid registry data for '%s'", name)
	}
	
	info := &RegistryInfo{}
	
	if url, exists := regMap["url"]; exists {
		if urlStr, ok := url.(string); ok {
			info.URL = urlStr
		}
	}
	
	if token, exists := regMap["token"]; exists {
		if tokenStr, ok := token.(string); ok {
			info.Token = tokenStr
		}
	}
	
	if username, exists := regMap["username"]; exists {
		if usernameStr, ok := username.(string); ok {
			info.Username = usernameStr
		}
	}
	
	return info, nil
}

// setRegistryToken sets the token for a specific registry
func setRegistryToken(config *Config, name, token, username string) error {
	registries := getRegistriesMap(config)
	
	regData, exists := registries[name]
	if !exists {
		return fmt.Errorf("registry '%s' not found", name)
	}
	
	regMap, ok := regData.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid registry data for '%s'", name)
	}
	
	regMap["token"] = token
	if username != "" {
		regMap["username"] = username
	}
	
	registries[name] = regMap
	config.Registry["registries"] = registries
	
	return SaveConfig(config)
}