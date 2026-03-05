package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// validatePackageName validates package name format (npm-style scoped packages)
func validatePackageName(name string) error {
	if name == "" {
		return errors.New("package name cannot be empty")
	}

	// Must start with @ for scoped packages
	if !strings.HasPrefix(name, "@") {
		return errors.New("package name must be scoped (start with @)")
	}

	// Format: @namespace/package-name
	// Allow lowercase letters, numbers, hyphens
	pattern := regexp.MustCompile(`^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$`)
	if !pattern.MatchString(name) {
		return errors.New("invalid package name format (expected @namespace/package-name with lowercase letters, numbers, and hyphens)")
	}

	// Check for dangerous patterns
	if strings.Contains(name, "..") || strings.Contains(name, "//") {
		return errors.New("package name contains invalid characters")
	}

	// Check length constraints
	if len(name) > 214 {
		return errors.New("package name too long (max 214 characters)")
	}

	parts := strings.Split(name, "/")
	if len(parts) != 2 {
		return errors.New("package name must have exactly one '/' separator")
	}

	namespace := parts[0] // includes @
	pkgName := parts[1]

	if len(namespace) < 2 {
		return errors.New("namespace too short")
	}

	if len(pkgName) < 1 {
		return errors.New("package name too short")
	}

	return nil
}

// validateVersion validates semantic versioning format
func validateVersion(version string) error {
	if version == "" {
		return errors.New("version cannot be empty")
	}

	// Strict semver: x.y.z (numbers only)
	pattern := regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
	if !pattern.MatchString(version) {
		return errors.New("version must follow semantic versioning format (x.y.z with non-negative integers)")
	}

	// Additional check: parse and validate ranges
	parts := strings.Split(version, ".")
	if len(parts) != 3 {
		return errors.New("version must have exactly 3 parts (major.minor.patch)")
	}

	return nil
}

// validateRegistryURL validates registry URL format and security
func validateRegistryURL(urlStr string) error {
	if urlStr == "" {
		return errors.New("URL cannot be empty")
	}

	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return fmt.Errorf("invalid URL format: %v", err)
	}

	// Must be HTTPS except for localhost
	if parsedURL.Scheme != "https" {
		// Allow HTTP only for localhost and 127.0.0.1
		if !strings.Contains(parsedURL.Host, "localhost") &&
			!strings.Contains(parsedURL.Host, "127.0.0.1") &&
			!strings.Contains(parsedURL.Host, "[::1]") {
			return errors.New("registry URL must use HTTPS (except localhost for development)")
		}
	}

	// Must have host
	if parsedURL.Host == "" {
		return errors.New("registry URL must have a host")
	}

	// Check for dangerous patterns in URL
	if strings.Contains(urlStr, "..") || strings.Contains(urlStr, "//") {
		// Allow // in scheme (https://) but not elsewhere
		withoutScheme := strings.TrimPrefix(urlStr, parsedURL.Scheme+"://")
		if strings.Contains(withoutScheme, "//") || strings.Contains(withoutScheme, "..") {
			return errors.New("registry URL contains suspicious patterns")
		}
	}

	return nil
}

// sanitizeFilePath sanitizes file paths to prevent directory traversal
func sanitizeFilePath(path string, basePath string) (string, error) {
	// SECURITY: Check for null bytes on raw input BEFORE cleaning
	if strings.Contains(path, "\x00") {
		return "", errors.New("path contains null bytes")
	}

	// Clean the path
	cleanPath := filepath.Clean(path)

	// Check for absolute paths (should be relative)
	if filepath.IsAbs(cleanPath) {
		return "", errors.New("path must be relative, not absolute")
	}

	// Check for dangerous patterns
	if strings.HasPrefix(cleanPath, "..") ||
		strings.Contains(cleanPath, string(filepath.Separator)+"..") ||
		strings.Contains(cleanPath, ".."+string(filepath.Separator)) {
		return "", errors.New("path contains directory traversal (..)  ")
	}

	// If basePath provided, ensure path is within it
	if basePath != "" {
		absPath, err := filepath.Abs(filepath.Join(basePath, cleanPath))
		if err != nil {
			return "", fmt.Errorf("could not resolve absolute path: %v", err)
		}

		absBase, err := filepath.Abs(basePath)
		if err != nil {
			return "", fmt.Errorf("could not resolve base path: %v", err)
		}

		// Ensure absPath starts with absBase
		if !strings.HasPrefix(absPath, absBase) {
			return "", errors.New("path escapes base directory")
		}

		return cleanPath, nil
	}

	return cleanPath, nil
}

// isSecurePath validates that a path is safe for ZIP operations (enhanced ZIP slip protection)
func isSecurePath(path string, basePath string) error {
	// SECURITY: Check for null bytes on raw input BEFORE cleaning
	if strings.Contains(path, "\x00") {
		return errors.New("path contains null bytes")
	}

	// Clean and normalize path
	cleanPath := filepath.Clean(path)

	// Check for absolute paths
	if filepath.IsAbs(cleanPath) {
		return errors.New("path is absolute (must be relative)")
	}

	// Check for directory traversal
	if strings.HasPrefix(cleanPath, "..") ||
		strings.Contains(cleanPath, string(filepath.Separator)+"..") ||
		strings.Contains(cleanPath, ".."+string(filepath.Separator)) {
		return errors.New("path contains directory traversal")
	}

	// Check for symlinks (if file exists)
	if basePath != "" {
		fullPath := filepath.Join(basePath, cleanPath)
		if info, err := os.Lstat(fullPath); err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return errors.New("path is a symlink (security risk)")
			}
		}
	}

	// Validate final path is within base
	if basePath != "" {
		finalPath, err := filepath.Abs(filepath.Join(basePath, cleanPath))
		if err != nil {
			return fmt.Errorf("could not resolve final path: %v", err)
		}

		absBase, err := filepath.Abs(basePath)
		if err != nil {
			return fmt.Errorf("could not resolve base path: %v", err)
		}

		// Ensure finalPath is within absBase (directory traversal check)
		if !strings.HasPrefix(finalPath+string(filepath.Separator), absBase+string(filepath.Separator)) {
			return errors.New("path escapes base directory")
		}
	}

	return nil
}

// isMaliciousContent checks for potentially malicious code patterns
func isMaliciousContent(content string) bool {
	maliciousPatterns := []string{
		"eval(",
		"exec(",
		"os.system(",
		"subprocess.call(",
		"subprocess.Popen(",
		"Runtime.getRuntime().exec(",
		"<script>",
		"javascript:",
		"cmd /c",
		"powershell -",
		"base64 -d",
		"chmod +x",
		"/bin/sh",
		"/bin/bash",
	}

	lowerContent := strings.ToLower(content)
	for _, pattern := range maliciousPatterns {
		if strings.Contains(lowerContent, strings.ToLower(pattern)) {
			return true
		}
	}

	return false
}

// validateDescription validates package description
func validateDescription(description string) error {
	if description == "" {
		return errors.New("description cannot be empty")
	}

	if len(description) > 500 {
		return errors.New("description too long (max 500 characters)")
	}

	// Check for suspicious patterns
	if isMaliciousContent(description) {
		return errors.New("description contains suspicious content")
	}

	return nil
}

// validateAuthor validates package author field
func validateAuthor(author string) error {
	if author == "" {
		return nil // Author is optional
	}

	if len(author) > 200 {
		return errors.New("author field too long (max 200 characters)")
	}

	// Check for suspicious patterns
	if isMaliciousContent(author) {
		return errors.New("author field contains suspicious content")
	}

	return nil
}
