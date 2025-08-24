package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

Examples:
  prompd provider list
  prompd provider add local-llm http://localhost:8080/v1 llama2 codellama
  prompd provider show openai`)
}

func handleProviderList() {
	fmt.Println("Available LLM Providers:")
	fmt.Println("  🔧 Built-in Providers:")
	fmt.Println("    • openai (GPT-3.5, GPT-4, etc.)")
	fmt.Println("    • anthropic (Claude models)")
	fmt.Println("    • ollama (Local models)")
	fmt.Println("    • groq (Fast inference)")
	
	// TODO: Read from config file for custom providers
	fmt.Println("  🏠 Custom Providers:")
	fmt.Println("    (No custom providers configured)")
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
	
	fmt.Printf("Adding provider '%s':\n", name)
	fmt.Printf("  Base URL: %s\n", baseURL)
	fmt.Printf("  Models: %s\n", strings.Join(models, ", "))
	fmt.Println("  Status: ✓ Added (demo mode - config not persisted)")
}

func handleProviderRemove() {
	if len(os.Args) < 4 {
		fmt.Println("Error: provider remove requires a provider name")
		os.Exit(1)
	}
	
	name := os.Args[3]
	fmt.Printf("✓ Removed provider '%s' (demo mode)\n", name)
}

func handleProviderShow() {
	if len(os.Args) < 4 {
		fmt.Println("Error: provider show requires a provider name")
		os.Exit(1)
	}
	
	name := os.Args[3]
	
	switch name {
	case "openai":
		fmt.Printf("Provider: %s (Built-in)\n", name)
		fmt.Println("Models: gpt-3.5-turbo, gpt-4, gpt-4-turbo, gpt-4o")
		fmt.Println("API Key: Set via OPENAI_API_KEY environment variable")
	case "anthropic":
		fmt.Printf("Provider: %s (Built-in)\n", name)
		fmt.Println("Models: claude-3-haiku, claude-3-sonnet, claude-3-opus")
		fmt.Println("API Key: Set via ANTHROPIC_API_KEY environment variable")
	case "ollama":
		fmt.Printf("Provider: %s (Built-in)\n", name)
		fmt.Println("Models: Dynamic (depends on locally installed models)")
		fmt.Println("API Key: Not required (local)")
	default:
		fmt.Printf("Provider '%s' not found\n", name)
		os.Exit(1)
	}
}

// Git operations
func printGitUsage() {
	fmt.Println(`Git Operations Commands:

Usage:
  prompd git <subcommand> [options]

Subcommands:
  add <files...>          Add .prompd files to git staging
  commit -m <message>     Commit staged .prompd files
  status                  Show git status for .prompd files
  checkout <file> <version> Checkout specific version of file

Examples:
  prompd git add prompts/*.prompd
  prompd git commit -m "Update prompts"
  prompd git status
  prompd git checkout example.prompd v1.2.3`)
}

func handleGitAdd() {
	if len(os.Args) < 4 {
		fmt.Println("Error: git add requires file paths")
		os.Exit(1)
	}
	
	files := os.Args[3:]
	for _, file := range files {
		if !strings.HasSuffix(file, ".prompd") {
			fmt.Printf("Warning: Skipping non-.prompd file: %s\n", file)
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
	
	fmt.Println("Git status for .prompd files:")
	lines := strings.Split(string(output), "\n")
	found := false
	
	for _, line := range lines {
		if strings.Contains(line, ".prompd") && strings.TrimSpace(line) != "" {
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
		fmt.Println("  No .prompd file changes")
	}
}

func handleGitCheckout() {
	if len(os.Args) < 5 {
		fmt.Println("Error: git checkout requires <file> <version>")
		os.Exit(1)
	}
	
	file := os.Args[3]
	version := os.Args[4]
	
	if !strings.HasSuffix(file, ".prompd") {
		fmt.Printf("Error: %s is not a .prompd file\n", file)
		os.Exit(1)
	}
	
	// Try semantic version tag first
	versionRef := version
	if isValidSemver(version) {
		tagName := fmt.Sprintf("%s-v%s", strings.TrimSuffix(filepath.Base(file), ".prompd"), version)
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

Examples:
  prompd version bump example.prompd minor
  prompd version history example.prompd
  prompd version diff example.prompd v1.0.0 v1.1.0`)
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
	
	// TODO: Actually update the file and create git tag
	fmt.Println("✓ Version bumped (demo mode)")
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