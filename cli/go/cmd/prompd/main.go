package main

import (
	"fmt"
	"os"
)

var version = "0.3.0"

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
	case "run":
		handleRun()
	case "compile":
		handleCompile()
	case "cache":
		handleCache()
	case "package":
		handlePackage()
	case "registry":
		handleRegistry()
	case "login":
		handleTopLevelLogin()
	case "logout":
		handleTopLevelLogout()
	case "publish":
		handleTopLevelPublish()
	case "search":
		handleTopLevelSearch()
	case "install":
		handleTopLevelInstall()
	case "versions":
		handleTopLevelVersions()
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

🚀 Core Commands:
  validate <file>           Validate a .prmd file
  list [path]              List .prmd files in directory  
  show <file>              Show file structure and parameters
  compile <file> [options] Multi-stage compilation with binary extraction
  run <file> [options]     Execute a .prmd file with LLM (redirects to Python CLI)
  
📦 Package Management:
  package <source>         Create a .pdpkg package from .pdproj file or directory
  cache <subcommand>       Package cache management
  
🌐 Registry Operations (npm-style):
  login [token]            Authenticate with registry
  logout                   Clear authentication
  publish <file>           Publish a package to registry
  search <query>           Search for packages
  install <package>        Install a package
  versions <package>       List package versions
  registry <subcommand>    Advanced registry management

🔧 Additional Commands:
  provider <subcommand>    Manage LLM providers (limited in Go CLI)
  providers                List available LLM providers  
  git <subcommand>         Git operations for .prmd files
  version <subcommand>     Version management commands
  help                     Show this help

Registry Management Commands:
  prompd registry list                 List configured registries
  prompd registry add <name> <url>     Add a new registry
  prompd registry remove <name>        Remove a registry
  prompd registry set-default <name>   Set default registry
  prompd registry info <package>       Show detailed package information

Examples:
  prompd validate prompt.prmd
  prompd list prompts/
  prompd show example.prmd
  prompd login sk-ant-api_...
  prompd search code-review
  prompd publish my-prompt.pdpkg
  prompd install @security/audit@2.0.0
  prompd registry add company https://registry.company.com`)
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

func handleRender() {
	if len(os.Args) < 3 {
		fmt.Println("Error: render requires a file path")
		fmt.Println("Usage: prompd render <file> [options]")
		fmt.Println("Options:")
		fmt.Println("  -p key=value    Set parameter")
		fmt.Println("  --params <file> Load parameters from JSON file")
		fmt.Println("  -o <file>       Output to file")
		os.Exit(1)
	}
	
	file := os.Args[2]
	if err := renderFile(file, os.Args[3:]); err != nil {
		fmt.Printf("Error rendering file: %v\n", err)
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
	case "setkey":
		handleProviderSetKey()
	case "removekey":
		handleProviderRemoveKey()
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
	case "remove":
		handleGitRemove()
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
	case "suggest":
		handleVersionSuggest()
	default:
		fmt.Printf("Unknown version subcommand: %s\n", os.Args[2])
		printVersionUsage()
		os.Exit(1)
	}
}

// Top-level npm-style command handlers that adapt arguments for registry functions

func handleTopLevelLogin() {
	// Convert "prompd login [token]" to "prompd registry login -t [token]"
	args := []string{"prompd", "registry", "login"}
	
	if len(os.Args) >= 3 {
		// If token provided as argument
		args = append(args, "-t", os.Args[2])
		os.Args = args
	} else if len(os.Args) == 2 {
		// Show help for missing token
		fmt.Println("Usage: prompd login <token> [-r <registry>]")
		fmt.Println("       prompd login -t <token> [-r <registry>]")
		os.Exit(1)
	}
	
	handleRegistryLogin()
}

func handleTopLevelLogout() {
	// Convert "prompd logout" to "prompd registry logout"
	os.Args = []string{"prompd", "registry", "logout"}
	handleRegistryLogout()
}

func handleTopLevelPublish() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: prompd publish <file> [-r <registry>]")
		os.Exit(1)
	}
	// Convert "prompd publish <file>" to "prompd registry publish <file>"
	newArgs := []string{"prompd", "registry", "publish"}
	newArgs = append(newArgs, os.Args[2:]...)
	os.Args = newArgs
	handleRegistryPublish()
}

func handleTopLevelSearch() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: prompd search <query> [-r <registry>]")
		os.Exit(1)
	}
	// Convert "prompd search <query>" to "prompd registry search <query>"
	newArgs := []string{"prompd", "registry", "search"}
	newArgs = append(newArgs, os.Args[2:]...)
	os.Args = newArgs
	handleRegistrySearch()
}

func handleTopLevelInstall() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: prompd install <package> [-r <registry>]")
		os.Exit(1)
	}
	// Convert "prompd install <package>" to "prompd registry install <package>"
	newArgs := []string{"prompd", "registry", "install"}
	newArgs = append(newArgs, os.Args[2:]...)
	os.Args = newArgs
	handleRegistryInstall()
}

func handleTopLevelVersions() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: prompd versions <package> [-r <registry>]")
		os.Exit(1)
	}
	// Convert "prompd versions <package>" to "prompd registry versions <package>"
	newArgs := []string{"prompd", "registry", "versions"}
	newArgs = append(newArgs, os.Args[2:]...)
	os.Args = newArgs
	handleRegistryVersions()
}