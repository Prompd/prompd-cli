package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// SecretMatch represents a detected secret in a file
type SecretMatch struct {
	Type        string
	Line        int
	MaskedValue string
	FilePath    string
}

// secretPatterns defines patterns for detecting various types of secrets
var secretPatterns = map[string]*regexp.Regexp{
	"OpenAI API Key":        regexp.MustCompile(`sk-[a-zA-Z0-9]{48}`),
	"Anthropic API Key":     regexp.MustCompile(`sk-ant-api[0-9]{2}-[a-zA-Z0-9_-]{95}`),
	"AWS Access Key":        regexp.MustCompile(`AKIA[0-9A-Z]{16}`),
	"GitHub Token":          regexp.MustCompile(`gh[ps]_[a-zA-Z0-9]{36}`),
	"Prompd Registry Token": regexp.MustCompile(`prompd_[a-zA-Z0-9]{32,}`),
	"Private Key":           regexp.MustCompile(`-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----`),
	"Generic API Key":       regexp.MustCompile(`(?i)api[_-]?key[_-]?[=:]\s*['"]?([a-zA-Z0-9_\-]{32,})['"]?`),
	"Bearer Token":          regexp.MustCompile(`[Bb]earer\s+[a-zA-Z0-9_\-\.]{32,}`),
	"JWT Token":             regexp.MustCompile(`eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}`),
}

// detectSecretsInContent scans content string for secrets
func detectSecretsInContent(content string) []SecretMatch {
	var matches []SecretMatch
	lines := strings.Split(content, "\n")

	for lineNum, line := range lines {
		for secretType, pattern := range secretPatterns {
			if pattern.MatchString(line) {
				matches = append(matches, SecretMatch{
					Type:        secretType,
					Line:        lineNum + 1,
					MaskedValue: maskSecret(line),
					FilePath:    "",
				})
			}
		}
	}

	return matches
}

// scanFileForSecrets scans a file for secrets
func scanFileForSecrets(filePath string) ([]SecretMatch, error) {
	// Skip binary files
	if !isTextFile(filePath) {
		return nil, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var matches []SecretMatch
	scanner := bufio.NewScanner(file)
	lineNum := 0

	// Increase buffer size for long lines
	const maxScanTokenSize = 1024 * 1024
	buf := make([]byte, maxScanTokenSize)
	scanner.Buffer(buf, maxScanTokenSize)

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		for secretType, pattern := range secretPatterns {
			if pattern.MatchString(line) {
				matches = append(matches, SecretMatch{
					Type:        secretType,
					Line:        lineNum,
					MaskedValue: maskSecret(line),
					FilePath:    filePath,
				})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return matches, err
	}

	return matches, nil
}

// scanDirectoryForSecrets recursively scans directory for secrets
func scanDirectoryForSecrets(dir string, excludePatterns []string) ([]SecretMatch, error) {
	var allMatches []SecretMatch

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Skip excluded files and patterns
		baseName := filepath.Base(path)
		for _, pattern := range excludePatterns {
			matched, _ := filepath.Match(pattern, baseName)
			if matched {
				return nil
			}
		}

		// Skip binary and non-text files
		if !isTextFile(path) {
			return nil
		}

		matches, err := scanFileForSecrets(path)
		if err != nil {
			// Log error but continue scanning
			fmt.Fprintf(os.Stderr, "Warning: could not scan %s: %v\n", path, err)
			return nil
		}

		allMatches = append(allMatches, matches...)
		return nil
	})

	return allMatches, err
}

// maskSecret masks sensitive parts of content
func maskSecret(content string) string {
	// Mask the middle part of the secret
	if len(content) <= 8 {
		return "***"
	}

	// Show first 4 and last 4 characters
	if len(content) <= 20 {
		return content[:4] + "***"
	}

	return content[:8] + "..." + content[len(content)-8:]
}

// isTextFile checks if a file is likely to be text based on extension
func isTextFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	textExtensions := []string{
		".prmd", ".pdproj", ".yaml", ".yml", ".json", ".md", ".txt",
		".py", ".go", ".js", ".ts", ".tsx", ".jsx", ".sh", ".bat",
		".env", ".html", ".css", ".xml", ".toml", ".ini", ".conf",
		".c", ".cpp", ".h", ".hpp", ".java", ".cs", ".rb", ".php",
		".sql", ".r", ".lua", ".pl", ".swift", ".kt", ".rs",
	}

	for _, textExt := range textExtensions {
		if ext == textExt {
			return true
		}
	}

	// Also check for files without extensions (like .env, README, etc.)
	baseName := filepath.Base(path)
	noExtPatterns := []string{
		"readme", "license", "makefile", "dockerfile", "vagrantfile",
		".env", ".gitignore", ".dockerignore", ".npmignore",
	}

	lowerBase := strings.ToLower(baseName)
	for _, pattern := range noExtPatterns {
		if lowerBase == pattern || strings.HasPrefix(lowerBase, pattern+".") {
			return true
		}
	}

	return false
}

// shouldExcludeFile checks if a file should be excluded from packaging based on security
func shouldExcludeFile(path string) bool {
	baseName := strings.ToLower(filepath.Base(path))

	// Exclude common secret-containing files
	secretFiles := []string{
		".env", ".env.local", ".env.production", ".env.development",
		".env.test", "credentials.json", "secrets.yaml", "secrets.yml",
		"private.key", ".pem", ".p12", ".pfx", "keystore.jks",
	}

	for _, secretFile := range secretFiles {
		if strings.HasSuffix(baseName, secretFile) || baseName == secretFile {
			return true
		}
	}

	// Exclude files with "secret", "key", "token", "password" in name
	dangerousKeywords := []string{"secret", "key", "token", "password", "credential", "private"}
	for _, keyword := range dangerousKeywords {
		if strings.Contains(baseName, keyword) {
			ext := filepath.Ext(baseName)
			// Only exclude if it's a config/data file
			if ext == ".json" || ext == ".yaml" || ext == ".yml" || ext == ".env" || ext == ".txt" {
				return true
			}
		}
	}

	return false
}
