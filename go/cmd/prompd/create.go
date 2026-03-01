package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func handleCreate() {
	if len(os.Args) < 3 {
		printCreateUsage()
		os.Exit(1)
	}

	filePath := os.Args[2]

	// Handle help flags
	if filePath == "-h" || filePath == "--help" {
		printCreateUsage()
		return
	}

	// Ensure .prmd extension
	if !strings.HasSuffix(filePath, ".prmd") {
		filePath += ".prmd"
	}

	// Parse options
	name := ""
	description := ""
	author := ""
	version := "1.0.0"
	interactive := false

	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--name", "-n":
			if i+1 < len(os.Args) {
				name = os.Args[i+1]
				i++
			}
		case "--description", "-d":
			if i+1 < len(os.Args) {
				description = os.Args[i+1]
				i++
			}
		case "--author", "-a":
			if i+1 < len(os.Args) {
				author = os.Args[i+1]
				i++
			}
		case "--version", "-v":
			if i+1 < len(os.Args) {
				version = os.Args[i+1]
				i++
			}
		case "--interactive", "-i":
			interactive = true
		}
	}

	// Interactive mode
	if interactive {
		baseName := filepath.Base(filePath)
		fmt.Printf("Creating new %s interactively\n\n", baseName)

		// Generate default name from filename
		defaultName := strings.TrimSuffix(baseName, ".prmd")
		defaultName = strings.Title(strings.ReplaceAll(defaultName, "-", " "))

		name = promptWithDefault("Prompt name", defaultName)
		description = promptWithDefault("Description", description)
		author = promptWithDefault("Author", author)
		version = promptWithDefault("Version", version)

		// Ask about parameters
		if promptYesNo("Add parameters?", false) {
			fmt.Println("(Press Enter on empty name to finish)")
			params := []Parameter{}
			for {
				paramName := promptWithDefault("Parameter name (blank to finish)", "")
				if paramName == "" {
					break
				}
				paramType := promptWithDefault("Parameter type [string/number/integer/float/boolean/array/object/json/file/base64]", "string")
				paramDesc := promptWithDefault("Parameter description", "")
				paramRequired := promptYesNo("Required?", false)

				param := Parameter{
					Name:        paramName,
					Type:        paramType,
					Description: paramDesc,
					Required:    paramRequired,
				}
				params = append(params, param)
			}

			if err := createPrompdFileWithParams(filePath, name, description, author, version, params); err != nil {
				fmt.Printf("ERROR: Failed to create file: %v\n", err)
				os.Exit(1)
			}
		} else {
			if err := createPrompdFile(filePath, name, description, author, version); err != nil {
				fmt.Printf("ERROR: Failed to create file: %v\n", err)
				os.Exit(1)
			}
		}
	} else {
		// Generate defaults
		if name == "" {
			baseName := filepath.Base(filePath)
			baseName = strings.TrimSuffix(baseName, ".prmd")
			name = strings.Title(strings.ReplaceAll(baseName, "-", " "))
		}

		if err := createPrompdFile(filePath, name, description, author, version); err != nil {
			fmt.Printf("ERROR: Failed to create file: %v\n", err)
			os.Exit(1)
		}
	}

	fmt.Printf("✓ Created %s\n", filePath)
}

func createPrompdFile(filePath, name, description, author, version string) error {
	// Check if file exists
	if _, err := os.Stat(filePath); err == nil {
		return fmt.Errorf("file already exists: %s", filePath)
	}

	// Generate ID from filename
	baseName := filepath.Base(filePath)
	id := strings.TrimSuffix(baseName, ".prmd")

	// Create file content
	content := fmt.Sprintf(`---
id: %s
name: %s
version: %s`, id, name, version)

	if description != "" {
		content += fmt.Sprintf(`
description: %s`, description)
	}

	if author != "" {
		content += fmt.Sprintf(`
author: %s`, author)
	}

	content += `
---

# System
You are a helpful assistant.

# User
{prompt}
`

	// Write file
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func createPrompdFileWithParams(filePath, name, description, author, version string, params []Parameter) error {
	// Check if file exists
	if _, err := os.Stat(filePath); err == nil {
		return fmt.Errorf("file already exists: %s", filePath)
	}

	// Generate ID from filename
	baseName := filepath.Base(filePath)
	id := strings.TrimSuffix(baseName, ".prmd")

	// Create file content
	content := fmt.Sprintf(`---
id: %s
name: %s
version: %s`, id, name, version)

	if description != "" {
		content += fmt.Sprintf(`
description: %s`, description)
	}

	if author != "" {
		content += fmt.Sprintf(`
author: %s`, author)
	}

	if len(params) > 0 {
		content += `
parameters:`
		for _, param := range params {
			content += fmt.Sprintf(`
  - name: %s
    type: %s`, param.Name, param.Type)
			if param.Description != "" {
				content += fmt.Sprintf(`
    description: %s`, param.Description)
			}
			if param.Required {
				content += `
    required: true`
			}
		}
	}

	content += `
---

# System
You are a helpful assistant.

# User
{prompt}
`

	// Write file
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func promptWithDefault(prompt, defaultValue string) string {
	reader := bufio.NewReader(os.Stdin)
	if defaultValue != "" {
		fmt.Printf("%s [%s]: ", prompt, defaultValue)
	} else {
		fmt.Printf("%s: ", prompt)
	}

	input, _ := reader.ReadString('\n')
	input = strings.TrimSpace(input)

	if input == "" {
		return defaultValue
	}
	return input
}

func promptYesNo(prompt string, defaultValue bool) bool {
	reader := bufio.NewReader(os.Stdin)
	defaultStr := "N"
	if defaultValue {
		defaultStr = "Y"
	}

	fmt.Printf("%s [y/N] (default: %s): ", prompt, defaultStr)
	input, _ := reader.ReadString('\n')
	input = strings.ToLower(strings.TrimSpace(input))

	if input == "" {
		return defaultValue
	}
	return input == "y" || input == "yes"
}

func printCreateUsage() {
	fmt.Println(`Usage: prompd create <file> [options]

Create a new .prmd file

Arguments:
  <file>                    Path to the .prmd file to create

Options:
  -i, --interactive         Interactive mode with prompts
  -n, --name <name>         Prompt name
  -d, --description <desc>  Description
  -a, --author <author>     Author name
  -v, --version <version>   Version (default: 1.0.0)

Examples:
  prompd create my-prompt.prmd --interactive
  prompd create my-prompt.prmd --name "My Prompt" --description "Does something"
  prompd create analysis.prmd -n "Code Analysis" -a "John Doe"`)
}
