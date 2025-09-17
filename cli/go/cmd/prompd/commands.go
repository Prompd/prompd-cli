package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	
	"gopkg.in/yaml.v3"
)

// Provider management
func printProviderUsage() {
	fmt.Println(`Provider Management Commands:

Usage:
  prompd provider <subcommand> [options]

Subcommands:
  list                     List available LLM providers
  add <name> <url> <models> Add a custom LLM provider
  remove <name>           Remove a custom LLM provider  
  show <name>             Show provider details
  setkey <provider> <key>  Set API key for provider
  removekey <provider>     Remove API key for provider

Examples:
  prompd provider list
  prompd provider add local-llm http://localhost:8080/v1 llama2 codellama
  prompd provider show openai
  prompd provider setkey openai sk-...
  prompd provider removekey openai`)
}

func handleProviderList() {
	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Warning: Could not load config: %v\n", err)
		config = &Config{
			APIKeys:         make(map[string]string),
			CustomProviders: make(map[string]CustomProvider),
		}
	}
	
	fmt.Println("Available LLM Providers:")
	fmt.Println("")
	fmt.Println("🔧 Built-in Providers:")
	
	builtinProviders := map[string][]string{
		"openai":    {"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"},
		"anthropic": {"claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"},
		"groq":      {"llama3-8b-8192", "mixtral-8x7b-32768"},
		"ollama":    {"llama3.2", "qwen2.5", "codellama", "(dynamic - depends on local install)"},
	}
	
	for provider, models := range builtinProviders {
		isConfigured := config.IsProviderConfigured(provider)
		status := "✓"
		if !isConfigured && provider != "ollama" {
			status = "⚠ (no API key)"
		}
		
		fmt.Printf("  • %s %s\n", provider, status)
		if len(models) > 0 && models[0] != "(dynamic - depends on local install)" {
			// Safe slice operation
			maxModels := 3
			if len(models) < maxModels {
				maxModels = len(models)
			}
			fmt.Printf("    Models: %s\n", strings.Join(models[:maxModels], ", "))
			if len(models) > maxModels {
				fmt.Println("    (and more...)")
			}
		} else if len(models) > 0 {
			fmt.Printf("    Models: %s\n", models[0])
		}
	}
	
	fmt.Println("")
	fmt.Println("🏠 Custom Providers:")
	if len(config.CustomProviders) == 0 {
		fmt.Println("    (No custom providers configured)")
	} else {
		for name, provider := range config.CustomProviders {
			status := "✓"
			if !provider.Enabled {
				status = "⚠ (disabled)"
			} else if provider.APIKey == "" {
				status = "⚠ (no API key)"
			}
			
			fmt.Printf("  • %s %s\n", name, status)
			fmt.Printf("    Base URL: %s\n", provider.BaseURL)
			if len(provider.Models) > 0 {
				fmt.Printf("    Models: %s\n", strings.Join(provider.Models, ", "))
			}
		}
	}
	
	fmt.Println("")
	fmt.Println("Use 'prompd provider show <name>' for details")
}

func handleProviderAdd() {
	if len(os.Args) < 6 {
		fmt.Println("Error: provider add requires: <name> <base_url> <model1> [model2 ...]")
		fmt.Println("Example: prompd provider add local-llm http://localhost:8080/v1 llama2 codellama")
		os.Exit(1)
	}
	
	name := os.Args[3]
	baseURL := os.Args[4]
	models := os.Args[5:]
	
	config, err := LoadConfig()
	if err != nil {
		config = &Config{
			APIKeys:         make(map[string]string),
			CustomProviders: make(map[string]CustomProvider),
		}
	}
	
	// Check if provider already exists
	if _, exists := config.CustomProviders[name]; exists {
		fmt.Printf("Provider '%s' already exists. Use 'prompd provider remove %s' first.\n", name, name)
		os.Exit(1)
	}
	
	// Add the provider
	config.CustomProviders[name] = CustomProvider{
		BaseURL: baseURL,
		Models:  models,
		Type:    "openai-compatible",
		Enabled: true,
	}
	
	// Save config
	if err := saveConfig(config); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("✓ Added custom provider '%s'\n", name)
	fmt.Printf("  Base URL: %s\n", baseURL)
	fmt.Printf("  Models: %s\n", strings.Join(models, ", "))
	fmt.Println("  Type: openai-compatible")
	fmt.Println("")
	fmt.Println("Set API key with: export " + strings.ToUpper(name) + "_API_KEY=your_key")
}

func handleProviderRemove() {
	if len(os.Args) < 4 {
		fmt.Println("Error: provider remove requires a provider name")
		os.Exit(1)
	}
	
	name := os.Args[3]
	
	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}
	
	if _, exists := config.CustomProviders[name]; !exists {
		fmt.Printf("Provider '%s' not found\n", name)
		os.Exit(1)
	}
	
	// Remove the provider
	delete(config.CustomProviders, name)
	
	// Save config
	if err := saveConfig(config); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("✓ Removed provider '%s'\n", name)
}

func handleProviderShow() {
	if len(os.Args) < 4 {
		fmt.Println("Error: provider show requires a provider name")
		os.Exit(1)
	}
	
	name := os.Args[3]
	
	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Warning: Could not load config: %v\n", err)
		config = &Config{
			APIKeys:         make(map[string]string),
			CustomProviders: make(map[string]CustomProvider),
		}
	}
	
	// Check if it's a custom provider
	if customProvider, exists := config.CustomProviders[name]; exists {
		fmt.Printf("=== %s (Custom Provider) ===\n\n", name)
		fmt.Printf("Base URL: %s\n", customProvider.BaseURL)
		fmt.Printf("Type: %s\n", customProvider.Type)
		fmt.Printf("Enabled: %t\n", customProvider.Enabled)
		if customProvider.APIKey != "" {
			fmt.Printf("API Key: Set (from config)\n")
		} else {
			envKey := strings.ToUpper(name) + "_API_KEY"
			if os.Getenv(envKey) != "" {
				fmt.Printf("API Key: Set (from %s)\n", envKey)
			} else {
				fmt.Printf("API Key: Not set\n")
			}
		}
		fmt.Println("\nModels:")
		for _, model := range customProvider.Models {
			fmt.Printf("  • %s\n", model)
		}
		return
	}
	
	// Built-in providers
	builtinProviders := map[string]map[string]interface{}{
		"openai": {
			"models": []string{"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"},
			"env":    "OPENAI_API_KEY",
		},
		"anthropic": {
			"models": []string{"claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"},
			"env":    "ANTHROPIC_API_KEY",
		},
		"groq": {
			"models": []string{"llama3-8b-8192", "mixtral-8x7b-32768"},
			"env":    "GROQ_API_KEY",
		},
		"ollama": {
			"models": []string{"llama2", "codellama", "(depends on local installation)"},
			"env":    "(not required - local provider)",
		},
	}
	
	if providerInfo, exists := builtinProviders[name]; exists {
		fmt.Printf("=== %s (Built-in Provider) ===\n\n", name)
		
		hasApiKey := config.GetAPIKey(name) != ""
		envVar := providerInfo["env"].(string)
		
		if envVar == "(not required - local provider)" {
			fmt.Printf("API Key: %s\n", envVar)
		} else if hasApiKey {
			fmt.Printf("API Key: Set (from %s)\n", envVar)
		} else {
			fmt.Printf("API Key: Not set (set %s environment variable)\n", envVar)
		}
		
		fmt.Println("\nModels:")
		models := providerInfo["models"].([]string)
		for i, model := range models {
			if i < 10 { // Show first 10 models
				fmt.Printf("  • %s\n", model)
			}
		}
		if len(models) > 10 {
			fmt.Printf("  ... and %d more\n", len(models)-10)
		}
	} else {
		fmt.Printf("Provider '%s' not found\n", name)
		os.Exit(1)
	}
}

func handleProviderSetKey() {
	if len(os.Args) < 5 {
		fmt.Println("Error: provider setkey requires provider and API key")
		fmt.Println("Usage: prompd provider setkey <provider> <api_key>")
		os.Exit(1)
	}

	provider := os.Args[3]
	apiKey := os.Args[4]

	config, err := LoadConfig()
	if err != nil {
		config = &Config{
			APIKeys:         make(map[string]string),
			CustomProviders: make(map[string]CustomProvider),
		}
	}

	if config.APIKeys == nil {
		config.APIKeys = make(map[string]string)
	}

	config.APIKeys[provider] = apiKey

	if err := SaveConfig(config); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✓ API key set for %s\n", provider)
}

func handleProviderRemoveKey() {
	if len(os.Args) < 4 {
		fmt.Println("Error: provider removekey requires provider")
		fmt.Println("Usage: prompd provider removekey <provider>")
		os.Exit(1)
	}

	provider := os.Args[3]

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	if config.APIKeys != nil {
		delete(config.APIKeys, provider)
	}

	if err := SaveConfig(config); err != nil {
		fmt.Printf("Error saving config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✓ API key removed for %s\n", provider)
}

// Git operations
func printGitUsage() {
	fmt.Println(`Git Operations Commands:

Usage:
  prompd git <subcommand> [options]

Subcommands:
  add <files...>          Add .prmd files to git staging
  commit -m <message>     Commit staged .prmd files
  status                  Show git status for .prmd files
  checkout <file> <version> Checkout specific version of file
  remove <files...>       Remove .prmd files from git tracking

Examples:
  prompd git add prompts/*.prmd
  prompd git commit -m "Update prompts"
  prompd git status
  prompd git checkout example.prmd v1.2.3
  prompd git remove prompts/old.prmd --cached`)
}

func handleGitAdd() {
	if len(os.Args) < 4 {
		fmt.Println("Error: git add requires file paths")
		os.Exit(1)
	}
	
	files := os.Args[3:]
	for _, file := range files {
		if !strings.HasSuffix(file, ".prmd") {
			fmt.Printf("Warning: Skipping non-.prmd file: %s\n", file)
			continue
		}
		
		cmd := exec.Command("git", "add", file)
		if err := cmd.Run(); err != nil {
			fmt.Printf("Error adding %s: %v\n", file, err)
			continue
		}
		
		fmt.Printf("✓ Added %s\n", file)
	}
}

func handleGitCommit() {
	// Parse -m flag
	message := ""
	for i := 3; i < len(os.Args)-1; i++ {
		if os.Args[i] == "-m" {
			message = os.Args[i+1]
			break
		}
	}
	
	if message == "" {
		fmt.Println("Error: git commit requires -m <message>")
		os.Exit(1)
	}
	
	cmd := exec.Command("git", "commit", "-m", message)
	if err := cmd.Run(); err != nil {
		fmt.Printf("Error committing: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("✓ Committed with message: %s\n", message)
}


func handleGitStatus() {
	cmd := exec.Command("git", "status", "--porcelain")
	output, err := cmd.Output()
	if err != nil {
		fmt.Printf("Error checking git status: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Println("Git status for .prmd files:")
	lines := strings.Split(string(output), "\n")
	found := false
	
	for _, line := range lines {
		if strings.Contains(line, ".prmd") && strings.TrimSpace(line) != "" {
			found = true
			status := line[:2]
			file := strings.TrimSpace(line[2:])
			
			statusText := "Modified"
			if strings.Contains(status, "A") {
				statusText = "Added"
			} else if strings.Contains(status, "D") {
				statusText = "Deleted"  
			} else if strings.Contains(status, "??") {
				statusText = "Untracked"
			}
			
			fmt.Printf("  %s: %s\n", statusText, file)
		}
	}
	
	if !found {
		fmt.Println("  No .prmd file changes")
	}
}

func handleGitCheckout() {
	if len(os.Args) < 5 {
		fmt.Println("Error: git checkout requires <file> <version>")
		os.Exit(1)
	}
	
	file := os.Args[3]
	version := os.Args[4]
	
	if !strings.HasSuffix(file, ".prmd") {
		fmt.Printf("Error: %s is not a .prmd file\n", file)
		os.Exit(1)
	}
	
	// Try semantic version tag first
	versionRef := version
	if isValidSemver(version) {
		tagName := fmt.Sprintf("%s-v%s", strings.TrimSuffix(filepath.Base(file), ".prmd"), version)
		// Check if tag exists
		cmd := exec.Command("git", "tag", "-l", tagName)
		if output, err := cmd.Output(); err == nil && strings.TrimSpace(string(output)) != "" {
			versionRef = tagName
		}
	}
	
	// Get file content at version
	cmd := exec.Command("git", "show", fmt.Sprintf("%s:%s", versionRef, file))
	content, err := cmd.Output()
	if err != nil {
		fmt.Printf("Error: Version '%s' not found for %s\n", version, file)
		os.Exit(1)
	}
	
	// Write to file
	if err := os.WriteFile(file, content, 0644); err != nil {
		fmt.Printf("Error writing file: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("✓ Checked out %s @ %s\n", file, version)
}

func handleGitRemove() {
	if len(os.Args) < 4 {
		fmt.Println("Error: git remove requires file paths")
		fmt.Println("Usage: prompd git remove <files...> [--cached]")
		fmt.Println("Options:")
		fmt.Println("  --cached    Remove from index but keep in working directory")
		os.Exit(1)
	}
	
	// Check for --cached flag
	cached := false
	files := []string{}
	
	for i := 3; i < len(os.Args); i++ {
		if os.Args[i] == "--cached" {
			cached = true
		} else {
			files = append(files, os.Args[i])
		}
	}
	
	if len(files) == 0 {
		fmt.Println("Error: no files specified")
		os.Exit(1)
	}
	
	for _, file := range files {
		if !strings.HasSuffix(file, ".prmd") {
			fmt.Printf("Warning: Skipping non-.prmd file: %s\n", file)
			continue
		}
		
		var cmd *exec.Cmd
		if cached {
			cmd = exec.Command("git", "rm", "--cached", file)
		} else {
			cmd = exec.Command("git", "rm", file)
		}
		
		if err := cmd.Run(); err != nil {
			fmt.Printf("Error removing %s: %v\n", file, err)
			continue
		}
		
		if cached {
			fmt.Printf("✓ Removed %s from git index (kept in working directory)\n", file)
		} else {
			fmt.Printf("✓ Removed %s from git tracking\n", file)
		}
	}
}

// Version management
func printVersionUsage() {
	fmt.Println(`Version Management Commands:

Usage:
  prompd version <subcommand> [options]

Subcommands:
  bump <file> <type>      Bump version (major|minor|patch)
  history <file>          Show version history
  diff <file> <v1> <v2>   Show differences between versions
  validate <file>         Validate version consistency
  suggest <file>          Suggest appropriate version bump

Examples:
  prompd version bump example.prmd minor
  prompd version history example.prmd
  prompd version diff example.prmd v1.0.0 v1.1.0
  prompd version suggest example.prmd`)
}

func handleVersionBump() {
	if len(os.Args) < 5 {
		fmt.Println("Error: version bump requires <file> <type>")
		fmt.Println("Types: major, minor, patch")
		os.Exit(1)
	}
	
	file := os.Args[3]
	bumpType := os.Args[4]
	
	if bumpType != "major" && bumpType != "minor" && bumpType != "patch" {
		fmt.Println("Error: bump type must be major, minor, or patch")
		os.Exit(1)
	}
	
	prompd, err := parsePrompdFile(file)
	if err != nil {
		fmt.Printf("Error parsing file: %v\n", err)
		os.Exit(1)
	}
	
	currentVersion := prompd.Metadata.Version
	if currentVersion == "" {
		currentVersion = "0.0.0"
	}
	
	newVersion := bumpVersion(currentVersion, bumpType)
	
	fmt.Printf("Bumping %s from %s to %s\n", file, currentVersion, newVersion)
	
	// Update the file
	if err := updateVersionInFile(file, newVersion); err != nil {
		fmt.Printf("Error updating file: %v\n", err)
		os.Exit(1)
	}
	
	// Create git commit and tag
	commitMessage := fmt.Sprintf("Bump %s to %s", filepath.Base(file), newVersion)
	if err := gitCommitAndTag(file, newVersion, commitMessage); err != nil {
		fmt.Printf("Error creating git commit/tag: %v\n", err)
		// Don't exit - the file was updated successfully
		fmt.Println("File updated but git operations failed")
	} else {
		fmt.Printf("✓ Created commit and tag: %s-v%s\n", strings.TrimSuffix(filepath.Base(file), ".prmd"), newVersion)
	}
	
	fmt.Printf("✓ Bumped %s from %s to %s\n", file, currentVersion, newVersion)
}

func handleVersionHistory() {
	if len(os.Args) < 4 {
		fmt.Println("Error: version history requires a file path")
		os.Exit(1)
	}
	
	file := os.Args[3]
	
	// Get git log for version tags
	cmd := exec.Command("git", "log", "--tags", "--oneline", "--decorate", file)
	output, err := cmd.Output()
	if err != nil {
		fmt.Printf("Error getting version history: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("Version history for %s:\n", file)
	if string(output) == "" {
		fmt.Println("  No version history found")
	} else {
		lines := strings.Split(strings.TrimSpace(string(output)), "\n")
		for _, line := range lines {
			if strings.TrimSpace(line) != "" {
				fmt.Printf("  %s\n", line)
			}
		}
	}
}

func handleVersionDiff() {
	if len(os.Args) < 6 {
		fmt.Println("Error: version diff requires <file> <version1> <version2>")
		os.Exit(1)
	}
	
	file := os.Args[3]
	v1 := os.Args[4]
	v2 := os.Args[5]
	
	cmd := exec.Command("git", "diff", v1, v2, file)
	output, err := cmd.Output()
	if err != nil {
		fmt.Printf("Error getting diff: %v\n", err)
		os.Exit(1)
	}
	
	if len(output) == 0 {
		fmt.Printf("No differences between %s and %s\n", v1, v2)
	} else {
		fmt.Printf("Diff %s: %s → %s\n", file, v1, v2)
		fmt.Println(strings.Repeat("-", 50))
		fmt.Print(string(output))
	}
}

func handleVersionValidate() {
	if len(os.Args) < 4 {
		fmt.Println("Error: version validate requires a file path")
		os.Exit(1)
	}
	
	file := os.Args[3]
	
	prompd, err := parsePrompdFile(file)
	if err != nil {
		fmt.Printf("Error parsing file: %v\n", err)
		os.Exit(1)
	}
	
	version := prompd.Metadata.Version
	if version == "" {
		fmt.Printf("Warning: No version specified in %s\n", file)
		return
	}
	
	if !isValidSemver(version) {
		fmt.Printf("Error: Invalid semantic version: %s\n", version)
		os.Exit(1)
	}
	
	fmt.Printf("✓ Version %s is valid\n", version)
}

func handleVersionSuggest() {
	if len(os.Args) < 4 {
		fmt.Println("Error: version suggest requires a file path")
		os.Exit(1)
	}
	
	file := os.Args[3]
	
	prompd, err := parsePrompdFile(file)
	if err != nil {
		fmt.Printf("Error parsing file: %v\n", err)
		os.Exit(1)
	}
	
	currentVersion := prompd.Metadata.Version
	if currentVersion == "" {
		currentVersion = "0.0.0"
	}
	
	// Check git diff to analyze changes
	cmd := exec.Command("git", "diff", file)
	output, _ := cmd.Output()
	
	// Simple heuristic for suggesting version bump
	var suggestedBump string
	var reason string
	
	if len(output) == 0 {
		fmt.Println("No changes detected in file")
		return
	}
	
	diffStr := string(output)
	
	// Check for breaking changes (removed parameters, changed types)
	if strings.Contains(diffStr, "-  - name:") || strings.Contains(diffStr, "type:") {
		suggestedBump = "major"
		reason = "Breaking changes detected (removed parameters or changed types)"
	} else if strings.Contains(diffStr, "+  - name:") || strings.Contains(diffStr, "+parameters:") {
		suggestedBump = "minor"
		reason = "New features detected (added parameters)"
	} else {
		suggestedBump = "patch"
		reason = "Bug fixes or minor changes detected"
	}
	
	// Calculate new versions for all bump types
	patchVersion := bumpVersion(currentVersion, "patch")
	minorVersion := bumpVersion(currentVersion, "minor")
	majorVersion := bumpVersion(currentVersion, "major")
	
	fmt.Println("Version Bump Suggestions")
	fmt.Println()
	fmt.Printf("Current Version: %s\n", currentVersion)
	fmt.Printf("Suggested Bump: %s → %s\n", suggestedBump, bumpVersion(currentVersion, suggestedBump))
	fmt.Println()
	fmt.Println("All Options:")
	fmt.Printf("  - Patch: %s (bug fixes)\n", patchVersion)
	fmt.Printf("  - Minor: %s (new features)\n", minorVersion)
	fmt.Printf("  - Major: %s (breaking changes)\n", majorVersion)
	fmt.Println()
	fmt.Printf("Reason: %s\n", reason)
}

func bumpVersion(version, bumpType string) string {
	parts := strings.Split(version, ".")
	if len(parts) != 3 {
		return "1.0.0" // fallback
	}
	
	major := 0
	minor := 0
	patch := 0
	
	fmt.Sscanf(parts[0], "%d", &major)
	fmt.Sscanf(parts[1], "%d", &minor)  
	fmt.Sscanf(parts[2], "%d", &patch)
	
	switch bumpType {
	case "major":
		major++
		minor = 0
		patch = 0
	case "minor":
		minor++
		patch = 0
	case "patch":
		patch++
	}
	
	return fmt.Sprintf("%d.%d.%d", major, minor, patch)
}

// updateVersionInFile updates the version field in a .prmd file
func updateVersionInFile(filename, newVersion string) error {
	content, err := os.ReadFile(filename)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}
	
	text := string(content)
	
	// Check if file starts with YAML frontmatter
	if !strings.HasPrefix(text, "---\n") {
		return fmt.Errorf("file must start with YAML frontmatter (---)")
	}
	
	// Find the end of frontmatter
	parts := strings.SplitN(text[4:], "\n---\n", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid frontmatter format")
	}
	
	yamlContent := parts[0]
	markdownContent := parts[1]
	
	// Parse and update YAML
	var metadata PrompdMetadata
	if err := yaml.Unmarshal([]byte(yamlContent), &metadata); err != nil {
		return fmt.Errorf("failed to parse YAML frontmatter: %w", err)
	}
	
	metadata.Version = newVersion
	
	// Marshal back to YAML
	updatedYaml, err := yaml.Marshal(&metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal YAML: %w", err)
	}
	
	// Write back to file
	updatedContent := fmt.Sprintf("---\n%s---\n%s", string(updatedYaml), markdownContent)
	if err := os.WriteFile(filename, []byte(updatedContent), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}
	
	return nil
}

// gitCommitAndTag creates a git commit and tag for the version bump
func gitCommitAndTag(filename, version, message string) error {
	// Add file to git
	cmd := exec.Command("git", "add", filename)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git add failed: %w", err)
	}
	
	// Commit
	cmd = exec.Command("git", "commit", "-m", message)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git commit failed: %w", err)
	}
	
	// Create tag
	tagName := fmt.Sprintf("%s-v%s", strings.TrimSuffix(filepath.Base(filename), ".prmd"), version)
	cmd = exec.Command("git", "tag", tagName)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git tag failed: %w", err)
	}
	
	return nil
}

// saveConfig saves the configuration to the first writable config path
func saveConfig(config *Config) error {
	configPaths := getConfigPaths()
	
	// Try to save to the first path that exists or can be created
	for _, path := range configPaths {
		dir := filepath.Dir(path)
		
		// Create directory if it doesn't exist
		if err := os.MkdirAll(dir, 0755); err != nil {
			continue // Try next path
		}
		
		// Marshal config to YAML
		data, err := yaml.Marshal(config)
		if err != nil {
			return fmt.Errorf("failed to marshal config: %w", err)
		}
		
		// Write to file
		if err := os.WriteFile(path, data, 0644); err != nil {
			continue // Try next path
		}
		
		fmt.Printf("Config saved to: %s\n", path)
		return nil
	}
	
	return fmt.Errorf("could not write config to any of the expected paths")
}

// handleCompile - Multi-stage compilation command
func handleCompile() {
	if len(os.Args) < 3 {
		printCompileUsage()
		return
	}

	sourcePath := os.Args[2]
	
	// Handle --help
	if sourcePath == "--help" || sourcePath == "-h" {
		printCompileUsage()
		return
	}
	outputFormat := "markdown"
	parameters := make(map[string]interface{})
	outputFile := ""
	verbose := false

	// Parse command line options
	for i := 3; i < len(os.Args); i++ {
		arg := os.Args[i]
		
		switch {
		case arg == "-p" && i+1 < len(os.Args):
			// Parse parameter key=value
			i++
			parts := strings.SplitN(os.Args[i], "=", 2)
			if len(parts) == 2 {
				parameters[parts[0]] = parts[1]
			}
		case arg == "-o" && i+1 < len(os.Args):
			i++
			outputFile = os.Args[i]
		case arg == "--to-markdown":
			outputFormat = "markdown"
		case arg == "--to-provider-json" && i+1 < len(os.Args):
			i++
			outputFormat = os.Args[i]
		case arg == "-v" || arg == "--verbose":
			verbose = true
		}
	}

	fmt.Printf("Compiling %s to %s format...\n", sourcePath, outputFormat)

	// Set verbose mode for package resolver
	globalPackageResolver.Verbose = verbose

	compiler := NewPrompDCompiler()
	result, err := compiler.Compile(sourcePath, outputFormat, parameters, outputFile, verbose)
	if err != nil {
		fmt.Printf("ERROR: Compilation failed: %v\n", err)
		os.Exit(1)
	}

	if outputFile != "" {
		fmt.Printf("SUCCESS: Compiled output saved to: %s\n", outputFile)
	} else {
		fmt.Println(result)
	}
	
	if verbose {
		fmt.Println("Compilation completed successfully")
	}
}

func printCompileUsage() {
	fmt.Println(`Compile Command - Multi-stage compilation pipeline

Usage:
  prompd compile <file> [options]

Arguments:
  <file>                    Path to .prmd file or package reference

Options:
  -p key=value             Parameter in format key=value
  -o <output>              Output file path
  --to-markdown            Compile to human-readable markdown (default)
  --to-provider-json <fmt> Compile to provider JSON format (openai, anthropic)
  -v, --verbose            Verbose output

Examples:
  prompd compile example.prmd
  prompd compile example.prmd -p name="Alice" -p style="formal"
  prompd compile example.prmd --to-provider-json openai
  prompd compile example.prmd -o output.md -v`)
}

// handleRun - Renamed from handleExecute  
func handleRun() {
	fmt.Println("ERROR: The 'run' command requires LLM provider integration.")
	fmt.Println("This lightweight Go CLI focuses on core operations (validate, list, show, compile, package, registry).")
	fmt.Println("For LLM execution, use the full-featured Python CLI:")
	fmt.Println("  pip install prompd")
	fmt.Println("  prompd run <file> --provider <provider> --model <model>")
	os.Exit(1)
}

// handleCache - Package cache management
func handleCache() {
	if len(os.Args) < 3 {
		printCacheUsage()
		return
	}

	subcommand := os.Args[2]
	
	switch subcommand {
	case "list":
		handleCacheList()
	case "clear":
		handleCacheClear()
	case "info":
		handleCacheInfo()
	default:
		fmt.Printf("Unknown cache subcommand: %s\n", subcommand)
		printCacheUsage()
		os.Exit(1)
	}
}

func handleCacheList() {
	packages, err := globalPackageResolver.Cache.ListCachedPackages()
	if err != nil {
		fmt.Printf("ERROR: Failed to list cached packages: %v\n", err)
		os.Exit(1)
	}

	if len(packages) == 0 {
		fmt.Println("No cached packages found.")
		return
	}

	fmt.Printf("Cached Packages (%d total):\n\n", len(packages))
	for i, pkg := range packages {
		manifest := pkg["manifest"].(map[string]interface{})
		name := "unknown"
		version := "unknown"
		description := ""

		if n, ok := manifest["name"].(string); ok {
			name = n
		}
		if v, ok := manifest["version"].(string); ok {
			version = v
		}
		if d, ok := manifest["description"].(string); ok {
			description = d
		}

		fmt.Printf("%d. %s@%s\n", i+1, name, version)
		if description != "" {
			fmt.Printf("   %s\n", description)
		}
		fmt.Printf("   Path: %s\n\n", pkg["path"])
	}
}

func handleCacheClear() {
	fmt.Println("Clearing package cache...")
	
	if err := globalPackageResolver.Cache.Clear(); err != nil {
		fmt.Printf("ERROR: Failed to clear cache: %v\n", err)
		os.Exit(1)
	}
	
	// Recreate the cache directory
	os.MkdirAll(globalPackageResolver.Cache.CacheDir, 0755)
	
	fmt.Println("SUCCESS: Package cache cleared.")
}

func handleCacheInfo() {
	packages, err := globalPackageResolver.Cache.ListCachedPackages()
	if err != nil {
		fmt.Printf("ERROR: Failed to get cache info: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Package Cache Information (Go CLI)")
	fmt.Println("")
	fmt.Printf("Cache Directory: %s\n", globalPackageResolver.Cache.CacheDir)
	fmt.Printf("Cached Packages: %d\n", len(packages))
	fmt.Printf("Registry URLs: %s\n", strings.Join(globalPackageResolver.RegistryURLs, ", "))
	
	// Show registry discovery status
	if len(globalPackageResolver.Registries) == 0 {
		globalPackageResolver.DiscoverRegistries()
	}
	
	fmt.Printf("Discovered Registries: %d\n", len(globalPackageResolver.Registries))
	for url, registry := range globalPackageResolver.Registries {
		fmt.Printf("  - %s (%s)\n", registry.Name, url)
	}
}

func printCacheUsage() {
	fmt.Println(`Cache Management Commands

Usage:
  prompd cache <subcommand>

Subcommands:
  list    List cached packages
  clear   Clear the package cache  
  info    Show cache information

Examples:
  prompd cache list
  prompd cache clear
  prompd cache info`)
}