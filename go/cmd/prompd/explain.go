package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func handleExplain() {
	if len(os.Args) < 3 {
		printExplainUsage()
		os.Exit(1)
	}

	target := os.Args[2]

	// Handle help flags
	if target == "-h" || target == "--help" {
		printExplainUsage()
		return
	}
	detailed := false
	sections := false
	registry := ""

	// Parse flags
	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-d", "--detailed":
			detailed = true
		case "-s", "--sections":
			sections = true
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registry = os.Args[i+1]
				i++
			}
		}
	}

	// Determine target type
	if strings.HasSuffix(target, ".prmd") {
		explainPrompdFile(target, detailed, sections)
	} else if strings.HasSuffix(target, ".pdpkg") {
		explainPackageFile(target, detailed)
	} else if strings.HasPrefix(target, "@") && strings.Contains(target, "/") {
		explainRegistryPackage(target, registry, detailed)
	} else {
		fmt.Println("ERROR: Invalid target. Must be a .prmd file, .pdpkg package, or registry package (@namespace/name)")
		os.Exit(1)
	}
}

func explainPrompdFile(filePath string, detailed bool, showSections bool) {
	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		fmt.Printf("ERROR: File not found: %s\n", filePath)
		os.Exit(1)
	}

	// Parse the file
	prompd, err := parsePrompdFile(filePath)
	if err != nil {
		fmt.Printf("ERROR: Failed to parse file: %v\n", err)
		os.Exit(1)
	}

	// Get file stats
	fileInfo, _ := os.Stat(filePath)

	fmt.Printf("\n📄 %s\n", filepath.Base(filePath))
	absPath, _ := filepath.Abs(filePath)
	fmt.Printf("   %s\n\n", absPath)

	// Metadata
	fmt.Println("Metadata:")
	fmt.Printf("  ID:          %s\n", prompd.Metadata.ID)
	if prompd.Metadata.Name != "" {
		fmt.Printf("  Name:        %s\n", prompd.Metadata.Name)
	}
	if prompd.Metadata.Version != "" {
		fmt.Printf("  Version:     %s\n", prompd.Metadata.Version)
	}
	if prompd.Metadata.Description != "" {
		fmt.Printf("  Description: %s\n", prompd.Metadata.Description)
	}
	fmt.Println()

	// Parameters
	if len(prompd.Metadata.Parameters) > 0 {
		fmt.Println("Parameters:")
		for _, param := range prompd.Metadata.Parameters {
			required := "optional"
			if param.Required {
				required = "required"
			}
			defaultVal := ""
			if param.Default != nil {
				defaultVal = fmt.Sprintf(" (default: %v)", param.Default)
			}
			fmt.Printf("  • %s (%s) %s%s\n", param.Name, param.Type, required, defaultVal)
			if param.Description != "" {
				fmt.Printf("    %s\n", param.Description)
			}
		}
		fmt.Println()
	}

	// Note: Section parsing not yet implemented in Go parser
	if showSections {
		fmt.Println("Note: Section display requires enhanced parser")
		fmt.Println()
	}

	// File info
	fmt.Println("File Info:")
	fmt.Printf("  Size:     %s\n", formatBytes(fileInfo.Size()))
	fmt.Printf("  Modified: %s\n", fileInfo.ModTime().Format(time.RFC1123))
	fmt.Println()
}

func explainPackageFile(filePath string, detailed bool) {
	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		fmt.Printf("ERROR: Package not found: %s\n", filePath)
		os.Exit(1)
	}

	fileInfo, _ := os.Stat(filePath)

	fmt.Printf("\n📦 %s\n", filepath.Base(filePath))
	absPath, _ := filepath.Abs(filePath)
	fmt.Printf("   %s\n\n", absPath)

	fmt.Println("Package Info:")
	fmt.Printf("  Size:     %s\n", formatBytes(fileInfo.Size()))
	fmt.Printf("  Modified: %s\n", fileInfo.ModTime().Format(time.RFC1123))
	fmt.Println()

	if detailed {
		fmt.Println("Use 'prompd package validate' for detailed package inspection")
		fmt.Println()
	}
}

func explainRegistryPackage(packageName string, registry string, detailed bool) {
	fmt.Printf("Fetching package info for %s...\n\n", packageName)

	// Get package info from registry
	info, err := getPackageInfo(packageName, registry)
	if err != nil {
		fmt.Printf("ERROR: Failed to get package info: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\n📦 %s\n\n", packageName)

	if info.Description != "" {
		fmt.Println(info.Description)
		fmt.Println()
	}

	fmt.Println("Package Info:")
	fmt.Printf("  Name:    %s\n", info.Name)
	if info.Version != "" {
		fmt.Printf("  Version: %s\n", info.Version)
	}
	fmt.Println()

	// Get versions
	versions, err := getPackageVersions(packageName, registry)
	if err == nil && len(versions) > 0 {
		fmt.Println("Available Versions:")
		displayCount := 5
		if detailed {
			displayCount = len(versions)
		}

		for i := 0; i < displayCount && i < len(versions); i++ {
			marker := ""
			if i == 0 {
				marker = " (latest)"
			}
			fmt.Printf("  • %s%s\n", versions[i], marker)
		}

		if !detailed && len(versions) > 5 {
			fmt.Printf("  ... and %d more (use --detailed to see all)\n", len(versions)-5)
		}
		fmt.Println()
	}

	if info.Author != "" {
		fmt.Println("Author:")
		fmt.Printf("  %s\n", info.Author)
		fmt.Println()
	}
}

func printExplainUsage() {
	fmt.Println(`Usage: prompd explain <target> [options]

Detailed information about files and packages

Arguments:
  <target>              .prmd file, .pdpkg package, or registry package (@namespace/name)

Options:
  -d, --detailed        Show detailed information
  -s, --sections        Show section content previews (for .prmd files)
  -r, --registry <name> Specify registry for package lookup

Examples:
  prompd explain example.prmd
  prompd explain example.prmd --sections
  prompd explain package.pdpkg
  prompd explain @namespace/package
  prompd explain @namespace/package --detailed`)
}

func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
