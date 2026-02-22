package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func handleUninstall() {
	if len(os.Args) < 3 {
		printUninstallUsage()
		os.Exit(1)
	}

	packages := []string{}
	globalUninstall := false

	// Parse arguments and flags
	for i := 2; i < len(os.Args); i++ {
		arg := os.Args[i]
		if arg == "-g" || arg == "--global" {
			globalUninstall = true
		} else if arg == "-h" || arg == "--help" {
			printUninstallUsage()
			return
		} else if !strings.HasPrefix(arg, "-") {
			packages = append(packages, arg)
		}
	}

	if len(packages) == 0 {
		fmt.Println("ERROR: No packages specified")
		printUninstallUsage()
		os.Exit(1)
	}

	// Uninstall each package
	for _, packageName := range packages {
		if err := uninstallPackage(packageName, globalUninstall); err != nil {
			fmt.Printf("ERROR: Failed to uninstall %s: %v\n", packageName, err)
			continue
		}

		location := "locally"
		if globalUninstall {
			location = "globally"
		}
		fmt.Printf("✓ Uninstalled %s %s\n", packageName, location)
	}
}

func uninstallPackage(packageName string, global bool) error {
	cacheDir := getCacheDir(global)

	// Find the package directory
	packageDir := filepath.Join(cacheDir, sanitizePackageName(packageName))

	// Check if package exists
	if _, err := os.Stat(packageDir); os.IsNotExist(err) {
		return fmt.Errorf("package not found in cache")
	}

	// Remove the package directory
	if err := os.RemoveAll(packageDir); err != nil {
		return fmt.Errorf("failed to remove package: %w", err)
	}

	return nil
}

func getCacheDir(global bool) string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}

	if global {
		return filepath.Join(homeDir, ".prompd", "cache", "global")
	}
	return filepath.Join(homeDir, ".prompd", "cache", "packages")
}

func sanitizePackageName(name string) string {
	// Convert @namespace/name to namespace-name for directory
	name = strings.ReplaceAll(name, "@", "")
	name = strings.ReplaceAll(name, "/", "-")
	return name
}

func printUninstallUsage() {
	fmt.Println(`Usage: prompd uninstall <packages...> [options]

Uninstall packages

Arguments:
  <packages...>         One or more package names to uninstall

Options:
  -g, --global          Uninstall packages globally

Examples:
  prompd uninstall @namespace/package
  prompd uninstall @namespace/package1 @namespace/package2
  prompd uninstall @namespace/package --global`)
}
