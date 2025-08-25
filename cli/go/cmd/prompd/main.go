package main

import (
	"fmt"
	"os"
)

var version = "0.2.3"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		return
	}

	switch os.Args[1] {
	case "validate":
		handleValidate()
	case "list":
		handleList()
	case "show":
		handleShow()
	case "execute":
		handleExecute()
	case "provider":
		handleProvider()
	case "providers":
		handleProviders()
	case "git":
		handleGit()
	case "version":
		handleVersion()
	case "--version", "-v":
		fmt.Printf("prompd v%s\n", version)
		return
	case "help", "-h", "--help":
		printUsage()
	default:
		fmt.Printf("Unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`prompd - CLI for structured prompt definitions

Usage:
  prompd <command> [options]

Commands:
  validate <file>           Validate a .prompd file
  list [path]              List .prompd files in directory  
  show <file>              Show file structure and parameters
  execute <file> [options] Execute a .prompd file with LLM
  provider <subcommand>    Manage LLM providers
  providers                List available LLM providers
  git <subcommand>         Git operations for .prompd files
  version <subcommand>     Version management commands
  help                     Show this help

Examples:
  prompd validate prompt.prompd
  prompd list prompts/
  prompd show example.prompd
  prompd execute example.prompd --provider openai --model gpt-4`)
}

func handleValidate() {
	if len(os.Args) < 3 {
		fmt.Println("Error: validate requires a file path")
		os.Exit(1)
	}
	
	file := os.Args[2]
	if err := validateFile(file); err != nil {
		fmt.Printf("Validation failed: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("✓ %s is valid\n", file)
}

func handleList() {
	path := "."
	if len(os.Args) > 2 {
		path = os.Args[2]
	}
	
	if err := listFiles(path); err != nil {
		fmt.Printf("Error listing files: %v\n", err)
		os.Exit(1)
	}
}

func handleShow() {
	if len(os.Args) < 3 {
		fmt.Println("Error: show requires a file path")
		os.Exit(1)
	}
	
	file := os.Args[2]
	if err := showFile(file); err != nil {
		fmt.Printf("Error showing file: %v\n", err)
		os.Exit(1)
	}
}

func handleExecute() {
	if len(os.Args) < 3 {
		fmt.Println("Error: execute requires a file path")
		os.Exit(1)
	}
	
	file := os.Args[2]
	if err := executeFile(file, os.Args[3:]); err != nil {
		fmt.Printf("Error executing file: %v\n", err)
		os.Exit(1)
	}
}

func handleProvider() {
	if len(os.Args) < 3 {
		printProviderUsage()
		return
	}
	
	switch os.Args[2] {
	case "list":
		handleProviderList()
	case "add":
		handleProviderAdd()
	case "remove":
		handleProviderRemove()
	case "show":
		handleProviderShow()
	default:
		fmt.Printf("Unknown provider subcommand: %s\n", os.Args[2])
		printProviderUsage()
		os.Exit(1)
	}
}

func handleProviders() {
	handleProviderList()
}

func handleGit() {
	if len(os.Args) < 3 {
		printGitUsage()
		return
	}
	
	switch os.Args[2] {
	case "add":
		handleGitAdd()
	case "commit":
		handleGitCommit()
	case "status":
		handleGitStatus()
	case "checkout":
		handleGitCheckout()
	default:
		fmt.Printf("Unknown git subcommand: %s\n", os.Args[2])
		printGitUsage()
		os.Exit(1)
	}
}

func handleVersion() {
	if len(os.Args) < 3 {
		fmt.Printf("prompd v%s\n", version)
		return
	}
	
	switch os.Args[2] {
	case "bump":
		handleVersionBump()
	case "history":
		handleVersionHistory()
	case "diff":
		handleVersionDiff()
	case "validate":
		handleVersionValidate()
	default:
		fmt.Printf("Unknown version subcommand: %s\n", os.Args[2])
		printVersionUsage()
		os.Exit(1)
	}
}