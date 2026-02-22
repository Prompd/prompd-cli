package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func handleInit() {
	projectPath := "."
	name := ""
	version := "1.0.0"
	description := ""
	author := ""

	// Parse arguments
	if len(os.Args) > 2 && os.Args[2] != "-h" && os.Args[2] != "--help" && !strings.HasPrefix(os.Args[2], "-") {
		projectPath = os.Args[2]
	}

	// Handle help
	for i := 2; i < len(os.Args); i++ {
		if os.Args[i] == "-h" || os.Args[i] == "--help" {
			printInitUsage()
			return
		}
	}

	// Parse options
	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--name":
			if i+1 < len(os.Args) {
				name = os.Args[i+1]
				i++
			}
		case "--version":
			if i+1 < len(os.Args) {
				version = os.Args[i+1]
				i++
			}
		case "--description":
			if i+1 < len(os.Args) {
				description = os.Args[i+1]
				i++
			}
		case "--author":
			if i+1 < len(os.Args) {
				author = os.Args[i+1]
				i++
			}
		}
	}

	if err := initProject(projectPath, name, version, description, author); err != nil {
		fmt.Printf("ERROR: Failed to initialize project: %v\n", err)
		os.Exit(1)
	}
}

func initProject(projectPath, name, version, description, author string) error {
	// Resolve absolute path
	absPath, err := filepath.Abs(projectPath)
	if err != nil {
		return fmt.Errorf("invalid path: %w", err)
	}

	// Create directory if it doesn't exist
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		if err := os.MkdirAll(absPath, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}
		fmt.Printf("✓ Created directory: %s\n", absPath)
	}

	// Check if manifest.json already exists
	manifestPath := filepath.Join(absPath, "manifest.json")
	if _, err := os.Stat(manifestPath); err == nil {
		fmt.Printf("Warning: manifest.json already exists in %s\n", absPath)
		fmt.Print("Overwrite? (y/N): ")
		var response string
		fmt.Scanln(&response)
		if strings.ToLower(response) != "y" {
			fmt.Println("Aborted")
			return nil
		}
	}

	// Generate smart defaults
	if name == "" {
		name = filepath.Base(absPath)
		name = strings.ToLower(name)
		name = strings.ReplaceAll(name, " ", "-")
		name = strings.ReplaceAll(name, "_", "-")
	}

	if description == "" {
		description = fmt.Sprintf("Prompd project: %s", name)
	}

	if author == "" {
		author = "unknown"
	}

	// Create manifest data
	manifest := map[string]interface{}{
		"name":        name,
		"version":     version,
		"description": description,
		"author":      author,
		"files": []string{
			"*.prmd",
			"*.md",
			"templates/",
			"docs/",
			"examples/",
		},
		"ignore": []string{
			"*.log",
			"*.tmp",
			".env*",
		},
		"dependencies":    map[string]string{},
		"devDependencies": map[string]string{},
	}

	// Write manifest.json
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to create manifest JSON: %w", err)
	}

	if err := os.WriteFile(manifestPath, manifestJSON, 0644); err != nil {
		return fmt.Errorf("failed to write manifest.json: %w", err)
	}

	fmt.Println("✓ Created manifest.json")
	fmt.Printf("✓ Initialized Prompd project: %s\n", name)

	// Create a sample .prmd file if none exists
	matches, _ := filepath.Glob(filepath.Join(absPath, "*.prmd"))
	if len(matches) == 0 {
		samplePath := filepath.Join(absPath, "example.prmd")
		sampleContent := fmt.Sprintf(`---
id: %s-example
name: %s Example
version: %s
description: Example prompt for %s
parameters:
  - name: name
    type: string
    required: true
    description: Name to greet
---

# System
You are a helpful assistant.

# User
Hello {name}! Welcome to %s.

This is an example .prmd file to get you started.

## Usage
` + "```bash\n" + `prompd run example.prmd --provider openai --model gpt-4o -p name="World"
` + "```", name, name, version, name, name)

		if err := os.WriteFile(samplePath, []byte(sampleContent), 0644); err != nil {
			return fmt.Errorf("failed to create example.prmd: %w", err)
		}

		fmt.Println("✓ Created example.prmd")
	}

	// Print success message
	fmt.Println("\nProject initialized!")
	fmt.Printf("  Directory: %s\n", absPath)
	fmt.Printf("  Name: %s\n", name)
	fmt.Printf("  Version: %s\n", version)
	fmt.Println("\nNext steps:")
	if absPath != "." {
		fmt.Printf("  cd %s\n", filepath.Base(absPath))
	}
	fmt.Println("  prompd validate example.prmd")
	fmt.Printf("  prompd pack . -o %s-%s.pdpkg\n", name, version)

	return nil
}

func printInitUsage() {
	fmt.Println(`Usage: prompd init [path] [options]

Initialize a new Prompd project with manifest.json

Arguments:
  [path]                    Project directory (default: current directory)

Options:
  --name <name>             Project name (default: directory name)
  --version <version>       Initial version (default: 1.0.0)
  --description <desc>      Project description
  --author <author>         Project author

Examples:
  prompd init
  prompd init my-project
  prompd init my-project --name "My Project" --description "AI prompts"
  prompd init . --author "John Doe"`)
}
