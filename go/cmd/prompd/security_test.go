package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectSecretsInContent(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		minExpected int // minimum number of detected secrets (broadened patterns may catch multiple types)
	}{
		{
			name:        "OpenAI key",
			content:     "OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH",
			minExpected: 1, // matches OpenAI pattern + possibly Generic API Key pattern
		},
		{
			name:        "Anthropic key",
			content:     "sk-ant-api01-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkLmNoPqRsTuVw",
			minExpected: 1,
		},
		{
			name:        "AWS access key",
			content:     "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
			minExpected: 1,
		},
		{
			name:        "GitHub token",
			content:     "GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz",
			minExpected: 1, // matches GitHub pattern + possibly Generic Secret (token=) pattern
		},
		{
			name:        "No secrets",
			content:     "This is just regular text with no secrets",
			minExpected: 0,
		},
		{
			name:        "Private key",
			content:     "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...",
			minExpected: 1,
		},
		{
			name:        "Multiple secrets",
			content:     "OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH\nGITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz",
			minExpected: 2, // at least one per line, possibly more from broadened patterns
		},
		{
			name:        "Bearer token",
			content:     "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ",
			minExpected: 1,
		},
		{
			name:        "URL-embedded credentials",
			content:     "DATABASE_URL=https://admin:secretpass123@db.example.com:5432/mydb",
			minExpected: 1,
		},
		{
			name:        "Stripe key",
			content:     "STRIPE_KEY=sk_test_4eC39HqLyjWDarjtT1zdp7dc",
			minExpected: 1,
		},
		{
			name:        "Google API key",
			content:     "GOOGLE_KEY=AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe",
			minExpected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matches := detectSecretsInContent(tt.content)
			if tt.minExpected == 0 {
				if len(matches) != 0 {
					t.Errorf("expected 0 secrets, got %d", len(matches))
				}
			} else if len(matches) < tt.minExpected {
				t.Errorf("expected at least %d secrets, got %d", tt.minExpected, len(matches))
			}
		})
	}
}

func TestMaskSecret(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Short string",
			input:    "secret",
			expected: "***",
		},
		{
			name:     "Medium string",
			input:    "this-is-a-secret-key",
			expected: "this***",
		},
		{
			name:     "Long string",
			input:    "sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH",
			expected: "sk-12345...ABCDEFGH",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := maskSecret(tt.input)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestIsTextFile(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{name: "Prmd file", path: "test.prmd", expected: true},
		{name: "YAML file", path: "config.yaml", expected: true},
		{name: "JSON file", path: "package.json", expected: true},
		{name: "Go file", path: "main.go", expected: true},
		{name: "Python file", path: "script.py", expected: true},
		{name: "Markdown file", path: "README.md", expected: true},
		{name: "Image file", path: "image.png", expected: false},
		{name: "Binary file", path: "app.exe", expected: false},
		{name: "ZIP file", path: "archive.zip", expected: false},
		{name: "Env file", path: ".env", expected: true},
		{name: "Gitignore", path: ".gitignore", expected: true},
		{name: "README without extension", path: "README", expected: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isTextFile(tt.path)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestShouldExcludeFile(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{name: "Env file", path: ".env", expected: true},
		{name: "Env local", path: ".env.local", expected: true},
		{name: "Credentials JSON", path: "credentials.json", expected: true},
		{name: "Secrets YAML", path: "secrets.yaml", expected: true},
		{name: "Private key", path: "private.key", expected: true},
		{name: "PEM file", path: "cert.pem", expected: true},
		{name: "Regular file", path: "README.md", expected: false},
		{name: "Normal JSON", path: "config.json", expected: false},
		{name: "Secret in name JSON", path: "api-secret.json", expected: true},
		{name: "Token in name YAML", path: "github-token.yaml", expected: true},
		{name: "Password in name", path: "password.txt", expected: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := shouldExcludeFile(tt.path)
			if result != tt.expected {
				t.Errorf("expected %v, got %v for %s", tt.expected, result, tt.path)
			}
		})
	}
}

func TestScanFileForSecrets(t *testing.T) {
	// Create temporary test file
	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "test.env")

	content := "OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH\n" +
		"DATABASE_URL=postgres://localhost/test\n" +
		"GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz\n"

	err := os.WriteFile(testFile, []byte(content), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	matches, err := scanFileForSecrets(testFile)
	if err != nil {
		t.Fatalf("scanFileForSecrets failed: %v", err)
	}

	if len(matches) < 2 {
		t.Errorf("expected at least 2 secrets, got %d", len(matches))
	}

	// Verify line numbers are set
	for _, match := range matches {
		if match.Line == 0 {
			t.Error("secret match missing line number")
		}
		if match.FilePath != testFile {
			t.Errorf("expected FilePath %s, got %s", testFile, match.FilePath)
		}
	}
}

func TestScanDirectoryForSecrets(t *testing.T) {
	// Create temporary test directory structure
	tempDir := t.TempDir()

	// Create test files
	err := os.WriteFile(filepath.Join(tempDir, "secrets.env"), []byte("OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH"), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	err = os.WriteFile(filepath.Join(tempDir, "safe.txt"), []byte("This file has no secrets"), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Test without exclusions
	matches, err := scanDirectoryForSecrets(tempDir, []string{})
	if err != nil {
		t.Fatalf("scanDirectoryForSecrets failed: %v", err)
	}

	if len(matches) == 0 {
		t.Error("expected to find secrets but found none")
	}

	// Test with exclusions
	matches, err = scanDirectoryForSecrets(tempDir, []string{"*.env"})
	if err != nil {
		t.Fatalf("scanDirectoryForSecrets failed: %v", err)
	}

	if len(matches) != 0 {
		t.Errorf("expected no secrets after exclusion, got %d", len(matches))
	}
}
