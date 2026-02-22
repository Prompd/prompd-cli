package main

import (
	"os"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// Save original environment
	originalEnvs := map[string]string{
		"OPENAI_API_KEY":       os.Getenv("OPENAI_API_KEY"),
		"ANTHROPIC_API_KEY":    os.Getenv("ANTHROPIC_API_KEY"),
		"GROQ_API_KEY":         os.Getenv("GROQ_API_KEY"),
		"PROMPD_DEFAULT_PROVIDER": os.Getenv("PROMPD_DEFAULT_PROVIDER"),
	}
	
	// Clean environment
	for key := range originalEnvs {
		os.Unsetenv(key)
	}
	
	defer func() {
		// Restore original environment
		for key, value := range originalEnvs {
			if value != "" {
				os.Setenv(key, value)
			} else {
				os.Unsetenv(key)
			}
		}
	}()

	t.Run("Default configuration", func(t *testing.T) {
		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}
		
		if config.MaxRetries != 3 {
			t.Errorf("Expected MaxRetries 3, got %d", config.MaxRetries)
		}
		
		if config.Timeout != 30 {
			t.Errorf("Expected Timeout 30, got %d", config.Timeout)
		}
		
		if config.APIKeys == nil {
			t.Error("APIKeys should not be nil")
		}
		
		if config.CustomProviders == nil {
			t.Error("CustomProviders should not be nil")
		}
	})
	
	t.Run("Environment variables", func(t *testing.T) {
		// Set test environment variables
		os.Setenv("OPENAI_API_KEY", "test-openai-key")
		os.Setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
		os.Setenv("GROQ_API_KEY", "test-groq-key")
		os.Setenv("PROMPD_DEFAULT_PROVIDER", "openai")
		
		// Reset global config to force reload
		globalConfig = nil
		
		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}
		
		if config.APIKeys["openai"] != "test-openai-key" {
			t.Errorf("Expected OpenAI key 'test-openai-key', got '%s'", config.APIKeys["openai"])
		}
		
		if config.APIKeys["anthropic"] != "test-anthropic-key" {
			t.Errorf("Expected Anthropic key 'test-anthropic-key', got '%s'", config.APIKeys["anthropic"])
		}
		
		if config.APIKeys["groq"] != "test-groq-key" {
			t.Errorf("Expected Groq key 'test-groq-key', got '%s'", config.APIKeys["groq"])
		}
		
		if config.DefaultProvider != "openai" {
			t.Errorf("Expected DefaultProvider 'openai', got '%s'", config.DefaultProvider)
		}
	})
}

func TestGetAPIKey(t *testing.T) {
	config := &Config{
		APIKeys: map[string]string{
			"openai":    "config-openai-key",
			"anthropic": "config-anthropic-key",
		},
		CustomProviders: map[string]CustomProvider{
			"custom1": {
				APIKey:  "custom1-key",
				BaseURL: "http://localhost:8080",
				Enabled: true,
			},
		},
	}

	tests := []struct {
		name     string
		provider string
		expected string
	}{
		{
			name:     "OpenAI from config",
			provider: "openai",
			expected: "config-openai-key",
		},
		{
			name:     "Anthropic from config",
			provider: "anthropic",
			expected: "config-anthropic-key",
		},
		{
			name:     "Custom provider",
			provider: "custom1",
			expected: "custom1-key",
		},
		{
			name:     "Unknown provider",
			provider: "unknown",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := config.GetAPIKey(tt.provider)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestGetDefaultProvider(t *testing.T) {
	tests := []struct {
		name            string
		defaultProvider string
		expected        string
	}{
		{
			name:            "Configured provider",
			defaultProvider: "anthropic",
			expected:        "anthropic",
		},
		{
			name:            "Empty provider - fallback to openai",
			defaultProvider: "",
			expected:        "openai",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := &Config{DefaultProvider: tt.defaultProvider}
			result := config.GetDefaultProvider()
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestGetDefaultModel(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		expected string
	}{
		{
			name:     "OpenAI default model",
			provider: "openai",
			expected: "gpt-4o-mini",
		},
		{
			name:     "Anthropic default model",
			provider: "anthropic",
			expected: "claude-3-5-haiku-20241022",
		},
		{
			name:     "Groq default model",
			provider: "groq",
			expected: "llama3-8b-8192",
		},
		{
			name:     "Unknown provider",
			provider: "unknown",
			expected: "default",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := &Config{}
			result := config.GetDefaultModel(tt.provider)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestIsProviderConfigured(t *testing.T) {
	config := &Config{
		APIKeys: map[string]string{
			"openai": "test-key",
		},
		CustomProviders: map[string]CustomProvider{
			"custom1": {
				APIKey:  "custom-key",
				BaseURL: "http://localhost:8080",
				Enabled: true,
			},
			"custom2": {
				BaseURL: "http://localhost:8081",
				Enabled: true,
				// No API key
			},
		},
	}

	tests := []struct {
		name     string
		provider string
		expected bool
	}{
		{
			name:     "Configured OpenAI",
			provider: "openai",
			expected: true,
		},
		{
			name:     "Unconfigured Anthropic",
			provider: "anthropic",
			expected: false,
		},
		{
			name:     "Ollama (local, no key needed)",
			provider: "ollama",
			expected: true,
		},
		{
			name:     "Configured custom provider",
			provider: "custom1",
			expected: true,
		},
		{
			name:     "Custom provider without API key",
			provider: "custom2",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := config.IsProviderConfigured(tt.provider)
			if result != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestListConfiguredProviders(t *testing.T) {
	config := &Config{
		APIKeys: map[string]string{
			"openai":    "test-openai-key",
			"anthropic": "test-anthropic-key",
		},
		CustomProviders: map[string]CustomProvider{
			"custom1": {
				APIKey:  "custom1-key",
				BaseURL: "http://localhost:8080",
				Enabled: true,
			},
			"custom2": {
				BaseURL: "http://localhost:8081",
				Enabled: false, // Disabled
				APIKey:  "custom2-key",
			},
		},
	}

	providers := config.ListConfiguredProviders()

	// Should include openai, anthropic, ollama (local), and custom1
	// Should NOT include groq (no key) or custom2 (disabled)
	expectedProviders := map[string]bool{
		"openai":    true,
		"anthropic": true,
		"ollama":    true, // Local provider
		"custom1":   true,
	}

	if len(providers) != len(expectedProviders) {
		t.Errorf("Expected %d providers, got %d: %v", len(expectedProviders), len(providers), providers)
	}

	for _, provider := range providers {
		if !expectedProviders[provider] {
			t.Errorf("Unexpected provider: %s", provider)
		}
	}

	for expected := range expectedProviders {
		found := false
		for _, provider := range providers {
			if provider == expected {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected provider not found: %s", expected)
		}
	}
}