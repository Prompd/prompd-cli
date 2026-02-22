package main

import (
	"fmt"
	"os"
	"strings"
)

func handleNamespace() {
	if len(os.Args) < 3 {
		printNamespaceUsage()
		os.Exit(1)
	}

	subcommand := os.Args[2]

	// Handle help flags
	if subcommand == "-h" || subcommand == "--help" {
		printNamespaceUsage()
		return
	}

	switch subcommand {
	case "list":
		handleNamespaceList()
	case "current":
		handleNamespaceCurrent()
	case "use":
		handleNamespaceUse()
	case "create":
		handleNamespaceCreate()
	default:
		fmt.Printf("Unknown namespace subcommand: %s\n", subcommand)
		printNamespaceUsage()
		os.Exit(1)
	}
}

func handleNamespaceList() {
	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("ERROR: Failed to load config: %v\n", err)
		os.Exit(1)
	}

	if len(config.Namespaces) == 0 {
		fmt.Println("No namespaces configured")
		return
	}

	fmt.Println("Available namespaces:")
	for namespace, registry := range config.Namespaces {
		current := ""
		if namespace == config.CurrentNamespace {
			current = " (current)"
		}
		fmt.Printf("  %s → %s%s\n", namespace, registry, current)
	}
}

func handleNamespaceCurrent() {
	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("ERROR: Failed to load config: %v\n", err)
		os.Exit(1)
	}

	if config.CurrentNamespace == "" {
		fmt.Println("No current namespace set")
		return
	}

	registry := config.Namespaces[config.CurrentNamespace]
	fmt.Printf("Current namespace: %s\n", config.CurrentNamespace)
	fmt.Printf("Registry: %s\n", registry)
}

func handleNamespaceUse() {
	if len(os.Args) < 4 {
		fmt.Println("ERROR: namespace use requires a namespace argument")
		fmt.Println("Usage: prompd namespace use @namespace")
		os.Exit(1)
	}

	namespace := os.Args[3]
	if !strings.HasPrefix(namespace, "@") {
		namespace = "@" + namespace
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("ERROR: Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Check if namespace exists
	if _, exists := config.Namespaces[namespace]; !exists {
		fmt.Printf("ERROR: Namespace '%s' not found\n", namespace)
		fmt.Println("Use 'prompd namespace list' to see available namespaces")
		os.Exit(1)
	}

	// Update current namespace
	config.CurrentNamespace = namespace
	if err := saveConfig(config); err != nil {
		fmt.Printf("ERROR: Failed to save config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✓ Switched to namespace: %s\n", namespace)
}

func handleNamespaceCreate() {
	if len(os.Args) < 4 {
		fmt.Println("ERROR: namespace create requires a namespace argument")
		fmt.Println("Usage: prompd namespace create @namespace [--registry <url>]")
		os.Exit(1)
	}

	namespace := os.Args[3]
	if !strings.HasPrefix(namespace, "@") {
		namespace = "@" + namespace
	}

	// Parse optional registry flag
	registryURL := ""
	for i := 4; i < len(os.Args); i++ {
		if os.Args[i] == "--registry" && i+1 < len(os.Args) {
			registryURL = os.Args[i+1]
			i++
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("ERROR: Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Check if namespace already exists
	if _, exists := config.Namespaces[namespace]; exists {
		fmt.Printf("ERROR: Namespace '%s' already exists\n", namespace)
		os.Exit(1)
	}

	// Use default registry if not specified
	if registryURL == "" {
		// Try to get default registry from config
		if defaultReg, ok := config.Registry["default"].(string); ok && defaultReg != "" {
			if registries, ok := config.Registry["registries"].(map[string]interface{}); ok {
				if regInfo, ok := registries[defaultReg].(map[string]interface{}); ok {
					if url, ok := regInfo["url"].(string); ok {
						registryURL = url
					}
				}
			}
		}
		if registryURL == "" {
			registryURL = "https://registry.prompdhub.ai"
		}
	}

	// Add namespace
	if config.Namespaces == nil {
		config.Namespaces = make(map[string]string)
	}
	config.Namespaces[namespace] = registryURL

	// Set as current if it's the first namespace
	if config.CurrentNamespace == "" {
		config.CurrentNamespace = namespace
	}

	if err := saveConfig(config); err != nil {
		fmt.Printf("ERROR: Failed to save config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✓ Created namespace: %s\n", namespace)
	fmt.Printf("  Registry: %s\n", registryURL)
}

func printNamespaceUsage() {
	fmt.Println(`Usage: prompd namespace <subcommand> [options]

Manage package namespaces

Subcommands:
  list                      List all configured namespaces
  current                   Show current namespace
  use <namespace>           Switch to a different namespace
  create <namespace>        Create a new namespace

Options:
  --registry <url>          Registry URL (for create command)

Examples:
  prompd namespace list
  prompd namespace current
  prompd namespace use @mycompany
  prompd namespace create @mycompany --registry https://registry.example.com`)
}
