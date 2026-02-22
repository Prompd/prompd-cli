package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func handleDeps() {
	if len(os.Args) < 3 {
		printDepsUsage()
		os.Exit(1)
	}

	target := os.Args[2]

	// Handle help flags
	if target == "-h" || target == "--help" {
		printDepsUsage()
		return
	}

	// Parse flags
	showTree := false
	showConflicts := false
	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--tree":
			showTree = true
		case "--conflicts":
			showConflicts = true
		}
	}

	if err := analyzeDependencies(target, showTree, showConflicts); err != nil {
		fmt.Printf("ERROR: %v\n", err)
		os.Exit(1)
	}
}

func analyzeDependencies(target string, showTree bool, showConflicts bool) error {
	// Check if target is a package reference or file/directory
	if strings.HasPrefix(target, "@") {
		return analyzePackageDeps(target, showTree, showConflicts)
	}

	// Check if it's a file or directory
	info, err := os.Stat(target)
	if err != nil {
		return fmt.Errorf("target not found: %w", err)
	}

	if info.IsDir() {
		return analyzeProjectDeps(target, showTree, showConflicts)
	}

	if strings.HasSuffix(target, ".prmd") {
		return analyzeFileDeps(target, showTree, showConflicts)
	}

	if strings.HasSuffix(target, ".pdpkg") {
		return analyzePackageFileDeps(target, showTree, showConflicts)
	}

	return fmt.Errorf("unsupported target type: %s", target)
}

func analyzeProjectDeps(projectPath string, showTree bool, showConflicts bool) error {
	manifestPath := filepath.Join(projectPath, "manifest.json")
	if _, err := os.Stat(manifestPath); os.IsNotExist(err) {
		return fmt.Errorf("no manifest.json found in %s", projectPath)
	}

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("failed to read manifest: %w", err)
	}

	var manifest map[string]interface{}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("failed to parse manifest: %w", err)
	}

	fmt.Printf("Dependencies for project: %s\n", projectPath)
	fmt.Println()

	deps := extractDependencies(manifest)
	devDeps := extractDevDependencies(manifest)

	if len(deps) == 0 && len(devDeps) == 0 {
		fmt.Println("No dependencies found")
		return nil
	}

	if len(deps) > 0 {
		fmt.Println("Dependencies:")
		for pkg, version := range deps {
			fmt.Printf("  %s@%s\n", pkg, version)
		}
		fmt.Println()
	}

	if len(devDeps) > 0 {
		fmt.Println("Dev Dependencies:")
		for pkg, version := range devDeps {
			fmt.Printf("  %s@%s\n", pkg, version)
		}
		fmt.Println()
	}

	if showTree {
		fmt.Println("Dependency Tree:")
		for pkg, version := range deps {
			printDependencyTree(pkg, version, 0, make(map[string]bool))
		}
	}

	if showConflicts {
		conflicts := detectConflicts(deps, devDeps)
		if len(conflicts) > 0 {
			fmt.Println("⚠️  Version Conflicts:")
			for _, conflict := range conflicts {
				fmt.Printf("  %s\n", conflict)
			}
		} else {
			fmt.Println("✓ No version conflicts detected")
		}
	}

	return nil
}

func analyzeFileDeps(filePath string, showTree bool, showConflicts bool) error {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	var prompd PrompdFile
	if err := yaml.Unmarshal(data, &prompd); err != nil {
		return fmt.Errorf("failed to parse .prmd file: %w", err)
	}

	fmt.Printf("Dependencies for file: %s\n", filePath)
	fmt.Println()

	if prompd.Metadata.Inherits == "" {
		fmt.Println("No inheritance dependencies")
		return nil
	}

	fmt.Printf("Inherits: %s\n", prompd.Metadata.Inherits)

	if showTree {
		fmt.Println("\nInheritance Chain:")
		printInheritanceChain(prompd.Metadata.Inherits, 0, make(map[string]bool))
	}

	return nil
}

func analyzePackageFileDeps(packagePath string, showTree bool, showConflicts bool) error {
	fmt.Printf("Analyzing package: %s\n", packagePath)
	fmt.Println("(Package dependency analysis not yet implemented)")
	return nil
}

func analyzePackageDeps(packageRef string, showTree bool, showConflicts bool) error {
	fmt.Printf("Analyzing package reference: %s\n", packageRef)
	fmt.Println("(Registry package analysis not yet implemented)")
	return nil
}

func extractDependencies(manifest map[string]interface{}) map[string]string {
	deps := make(map[string]string)
	if depsField, ok := manifest["dependencies"].(map[string]interface{}); ok {
		for pkg, version := range depsField {
			if v, ok := version.(string); ok {
				deps[pkg] = v
			}
		}
	}
	return deps
}

func extractDevDependencies(manifest map[string]interface{}) map[string]string {
	deps := make(map[string]string)
	if depsField, ok := manifest["devDependencies"].(map[string]interface{}); ok {
		for pkg, version := range depsField {
			if v, ok := version.(string); ok {
				deps[pkg] = v
			}
		}
	}
	return deps
}

func printDependencyTree(pkg string, version string, depth int, visited map[string]bool) {
	indent := strings.Repeat("  ", depth)
	key := fmt.Sprintf("%s@%s", pkg, version)

	if visited[key] {
		fmt.Printf("%s└─ %s (circular)\n", indent, key)
		return
	}

	visited[key] = true
	fmt.Printf("%s└─ %s\n", indent, key)

	// TODO: Fetch and analyze sub-dependencies
}

func printInheritanceChain(inherits string, depth int, visited map[string]bool) {
	indent := strings.Repeat("  ", depth)

	if visited[inherits] {
		fmt.Printf("%s└─ %s (circular reference)\n", indent, inherits)
		return
	}

	visited[inherits] = true
	fmt.Printf("%s└─ %s\n", indent, inherits)

	// TODO: Fetch parent and continue chain
}

func detectConflicts(deps map[string]string, devDeps map[string]string) []string {
	conflicts := []string{}

	for pkg, version := range deps {
		if devVersion, exists := devDeps[pkg]; exists {
			if version != devVersion {
				conflicts = append(conflicts, fmt.Sprintf(
					"%s: dependency uses %s, devDependency uses %s",
					pkg, version, devVersion,
				))
			}
		}
	}

	return conflicts
}

func printDepsUsage() {
	fmt.Println(`Usage: prompd deps <target> [options]

Analyze project dependencies

Arguments:
  <target>              File, directory, package, or package reference to analyze
                        - .prmd file: analyze inheritance dependencies
                        - .pdpkg file: analyze package dependencies
                        - directory: analyze manifest.json dependencies
                        - @namespace/package@version: analyze registry package

Options:
  --tree                Show dependency tree
  --conflicts           Check for version conflicts

Examples:
  prompd deps .
  prompd deps prompt.prmd
  prompd deps my-package.pdpkg --tree
  prompd deps @prompd/core@1.0.0 --tree
  prompd deps . --conflicts`)
}
