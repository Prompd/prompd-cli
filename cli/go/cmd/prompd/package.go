package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// PackageManifest represents the manifest.json structure in a .pdpkg file
type PackageManifest struct {
	Name        string                 `json:"name"`
	Version     string                 `json:"version"`
	Description string                 `json:"description"`
	Author      string                 `json:"author,omitempty"`
	Type        string                 `json:"type"`
	Files       map[string]interface{} `json:"files,omitempty"`
}

// PDProjMetadata represents the structure of a .pdproj file
type PDProjMetadata struct {
	Name        string                 `yaml:"name"`
	Version     string                 `yaml:"version"`
	Description string                 `yaml:"description"`
	Author      string                 `yaml:"author,omitempty"`
	Settings    map[string]interface{} `yaml:"settings,omitempty"`
	Exclusions  PDProjExclusions       `yaml:"exclusions,omitempty"`
}

type PDProjExclusions struct {
	Directories []string `yaml:"directories,omitempty"`
	Patterns    []string `yaml:"patterns,omitempty"`
}

func handlePackage() {
	if len(os.Args) < 3 {
		printPackageUsage()
		return
	}

	switch os.Args[2] {
	case "create":
		handlePackageCreate()
	case "validate":
		handlePackageValidate()
	default:
		// Legacy behavior - treat first arg as source if it looks like a file/directory
		if strings.HasSuffix(os.Args[2], ".pdproj") || !strings.HasPrefix(os.Args[2], "--") {
			// Shift arguments to maintain compatibility
			handlePackageCreateLegacy(os.Args[2:])
		} else {
			fmt.Printf("Unknown package subcommand: %s\n", os.Args[2])
			printPackageUsage()
			os.Exit(1)
		}
	}
}

func printPackageUsage() {
	fmt.Println(`Package Commands:
  prompd package create <source>       Create a .pdpkg from .pdproj file or directory
  prompd package validate <file>       Validate a .prompd or .pdpkg package
  
Examples:
  prompd package create project.pdproj
  prompd package create directory --name NAME --version VERSION --description DESC
  prompd package validate example.pdpkg`)
}

func handlePackageCreate() {
	if len(os.Args) < 4 {
		fmt.Println("Error: package create requires a source path (.pdproj file or directory)")
		fmt.Println("Usage:")
		fmt.Println("  prompd package create project.pdproj")
		fmt.Println("  prompd package create directory --name NAME --version VERSION --description DESC [--author AUTHOR]")
		os.Exit(1)
	}

	source := os.Args[3]
	
	// Check if source is a .pdproj file
	if strings.HasSuffix(source, ".pdproj") {
		if err := packageFromPdproj(source); err != nil {
			fmt.Printf("Error creating package from .pdproj: %v\n", err)
			os.Exit(1)
		}
	} else {
		// Directory mode - requires manual parameters
		if err := packageFromDirectory(source, os.Args[4:]); err != nil {
			fmt.Printf("Error creating package from directory: %v\n", err)
			os.Exit(1)
		}
	}
}

func handlePackageCreateLegacy(args []string) {
	source := args[0]
	
	// Check if source is a .pdproj file
	if strings.HasSuffix(source, ".pdproj") {
		if err := packageFromPdproj(source); err != nil {
			fmt.Printf("Error creating package from .pdproj: %v\n", err)
			os.Exit(1)
		}
	} else {
		// Directory mode - requires manual parameters
		if err := packageFromDirectory(source, args[1:]); err != nil {
			fmt.Printf("Error creating package from directory: %v\n", err)
			os.Exit(1)
		}
	}
}

func handlePackageValidate() {
	if len(os.Args) < 4 {
		fmt.Println("Error: package validate requires a .pdpkg file path")
		fmt.Println("Usage: prompd package validate <file.pdpkg>")
		os.Exit(1)
	}

	filePath := os.Args[3]
	
	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		fmt.Printf("Error: File does not exist: %s\n", filePath)
		os.Exit(1)
	}

	// Only accept .pdpkg files - packages are archives, not individual .prompd files
	if !strings.HasSuffix(filePath, ".pdpkg") {
		fmt.Printf("❌ Invalid package format!\n")
		fmt.Printf("   File: %s\n", filepath.Base(filePath))
		fmt.Printf("   Expected: .pdpkg archive file\n")
		fmt.Printf("   Note: .prompd files are individual prompts, not packages\n")
		fmt.Printf("   Use 'prompd validate' to validate individual .prompd files\n")
		os.Exit(1)
	}

	// Validate .pdpkg file structure
	if err := validatePdpkgFile(filePath); err != nil {
		fmt.Printf("❌ Package validation failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Package validation passed: %s\n", filepath.Base(filePath))
}

func packageFromPdproj(pdprojPath string) error {
	// Read and parse .pdproj file
	data, err := os.ReadFile(pdprojPath)
	if err != nil {
		return fmt.Errorf("failed to read .pdproj file: %v", err)
	}

	var metadata PDProjMetadata
	if err := yaml.Unmarshal(data, &metadata); err != nil {
		return fmt.Errorf("failed to parse .pdproj file: %v", err)
	}

	// Source directory is parent of .pdproj file
	sourceDir := filepath.Dir(pdprojPath)
	
	// Generate output path
	outputName := strings.ToLower(strings.ReplaceAll(metadata.Name, " ", "-"))
	outputPath := filepath.Join(sourceDir, fmt.Sprintf("%s-v%s.pdpkg", outputName, metadata.Version))

	// Create manifest
	manifest := PackageManifest{
		Name:        metadata.Name,
		Version:     metadata.Version,
		Description: metadata.Description,
		Author:      metadata.Author,
		Type:        "package",
	}

	// Create package
	if err := createPackage(sourceDir, outputPath, manifest, metadata.Exclusions); err != nil {
		return fmt.Errorf("failed to create package: %v", err)
	}

	fmt.Printf("✓ Package created successfully!\n")
	fmt.Printf("   Package: %s\n", outputPath)
	
	// Get file size
	if stat, err := os.Stat(outputPath); err == nil {
		fmt.Printf("   Size: %.1f KB\n", float64(stat.Size())/1024)
	}

	return nil
}

func packageFromDirectory(sourceDir string, args []string) error {
	// Parse arguments for directory mode
	var outputPath, name, version, description, author string
	
	if len(args) == 0 {
		return fmt.Errorf("directory packaging requires --name, --version, and --description flags")
	}

	// Simple argument parsing
	for i, arg := range args {
		switch arg {
		case "--name":
			if i+1 < len(args) {
				name = args[i+1]
			}
		case "--version":
			if i+1 < len(args) {
				version = args[i+1]
			}
		case "--description":
			if i+1 < len(args) {
				description = args[i+1]
			}
		case "--author":
			if i+1 < len(args) {
				author = args[i+1]
			}
		default:
			if !strings.HasPrefix(arg, "--") && outputPath == "" {
				outputPath = arg
			}
		}
	}

	if name == "" || version == "" || description == "" {
		return fmt.Errorf("--name, --version, and --description are required for directory packaging")
	}

	if outputPath == "" {
		outputPath = fmt.Sprintf("%s-v%s.pdpkg", strings.ToLower(strings.ReplaceAll(name, " ", "-")), version)
	}

	// Ensure .pdpkg extension
	if !strings.HasSuffix(outputPath, ".pdpkg") {
		outputPath += ".pdpkg"
	}

	manifest := PackageManifest{
		Name:        name,
		Version:     version,
		Description: description,
		Author:      author,
		Type:        "package",
	}

	// Create package with default exclusions
	exclusions := PDProjExclusions{
		Directories: []string{".git", ".prompd", "node_modules", "__pycache__"},
		Patterns:    []string{"*.log", "*.tmp", "*.cache", ".env*"},
	}

	if err := createPackage(sourceDir, outputPath, manifest, exclusions); err != nil {
		return fmt.Errorf("failed to create package: %v", err)
	}

	fmt.Printf("✓ Package created successfully!\n")
	fmt.Printf("   Package: %s\n", outputPath)
	
	if stat, err := os.Stat(outputPath); err == nil {
		fmt.Printf("   Size: %.1f KB\n", float64(stat.Size())/1024)
	}

	return nil
}

func createPackage(sourceDir, outputPath string, manifest PackageManifest, exclusions PDProjExclusions) error {
	// Create zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// Add manifest.json
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}

	manifestFile, err := zipWriter.Create("manifest.json")
	if err != nil {
		return err
	}
	if _, err := manifestFile.Write(manifestData); err != nil {
		return err
	}

	// Walk source directory and add files
	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Get relative path
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}

		// Skip the source directory itself
		if relPath == "." {
			return nil
		}

		// Check exclusions
		if shouldExclude(relPath, info, exclusions) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip directories (they'll be created automatically)
		if info.IsDir() {
			return nil
		}

		// Add file to zip
		zipPath := filepath.ToSlash(relPath) // Ensure forward slashes in zip
		
		zipFileWriter, err := zipWriter.Create(zipPath)
		if err != nil {
			return err
		}

		fileReader, err := os.Open(path)
		if err != nil {
			return err
		}
		defer fileReader.Close()

		_, err = io.Copy(zipFileWriter, fileReader)
		return err
	})
}

func shouldExclude(relPath string, info os.FileInfo, exclusions PDProjExclusions) bool {
	fileName := filepath.Base(relPath)
	
	// Always exclude .pdproj files - they're only for packaging metadata
	if strings.HasSuffix(fileName, ".pdproj") {
		return true
	}
	
	// Check directory exclusions
	if info.IsDir() {
		dirName := filepath.Base(relPath)
		for _, excl := range exclusions.Directories {
			if dirName == excl {
				return true
			}
		}
	}

	// Check pattern exclusions
	for _, pattern := range exclusions.Patterns {
		if matched, _ := filepath.Match(pattern, fileName); matched {
			return true
		}
	}

	return false
}


func validatePdpkgFile(filePath string) error {
	// Open ZIP file
	zipReader, err := zip.OpenReader(filePath)
	if err != nil {
		return fmt.Errorf("failed to open ZIP file: %v", err)
	}
	defer zipReader.Close()

	// SECURITY: Check for ZIP slip/directory traversal attacks
	for _, file := range zipReader.File {
		// Normalize path and check for traversal
		cleanPath := filepath.Clean(file.Name)
		if strings.Contains(cleanPath, "..") || filepath.IsAbs(file.Name) {
			return fmt.Errorf("security violation: path traversal detected in %s", file.Name)
		}
	}

	// Check for manifest.json
	var manifestFound bool
	for _, file := range zipReader.File {
		if file.Name == "manifest.json" {
			manifestFound = true
			
			// Read and validate manifest
			reader, err := file.Open()
			if err != nil {
				return fmt.Errorf("failed to read manifest.json: %v", err)
			}
			defer reader.Close()

			content, err := io.ReadAll(reader)
			if err != nil {
				return fmt.Errorf("failed to read manifest content: %v", err)
			}

			var manifest PackageManifest
			if err := json.Unmarshal(content, &manifest); err != nil {
				return fmt.Errorf("invalid manifest.json: %v", err)
			}

			// Validate required fields
			if manifest.Name == "" {
				return fmt.Errorf("missing 'name' in manifest.json")
			}
			if manifest.Version == "" {
				return fmt.Errorf("missing 'version' in manifest.json")
			}
			if manifest.Description == "" {
				return fmt.Errorf("missing 'description' in manifest.json")
			}

			break
		}
	}

	if !manifestFound {
		return fmt.Errorf("missing manifest.json in package")
	}

	return nil
}