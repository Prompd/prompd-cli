package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// PackageInfo represents package information from registry
type PackageInfo struct {
	Name           string                   `json:"name"`
	Version        string                   `json:"version"`
	LatestVersion  string                   `json:"latest_version"`
	Description    string                   `json:"description"`
	Author         string                   `json:"author"`
	License        string                   `json:"license"`
	Tags           []string                 `json:"tags"`
	Parameters     []map[string]interface{} `json:"parameters"`
	CreatedAt      string                   `json:"created_at"`
	UpdatedAt      string                   `json:"updated_at"`
	DownloadCount  int                      `json:"download_count"`
}

func handleRegistry() {
	if len(os.Args) < 3 {
		printRegistryUsage()
		return
	}

	switch os.Args[2] {
	case "list":
		handleRegistryList()
	case "add":
		handleRegistryAdd()
	case "remove":
		handleRegistryRemove()
	case "set-default":
		handleRegistrySetDefault()
	case "login":
		handleRegistryLogin()
	case "logout":
		handleRegistryLogout()
	case "search":
		handleRegistrySearch()
	case "info":
		handleRegistryInfo()
	case "publish":
		handleRegistryPublish()
	case "install":
		handleRegistryInstall()
	case "versions":
		handleRegistryVersions()
	default:
		fmt.Printf("Unknown registry command: %s\n", os.Args[2])
		printRegistryUsage()
	}
}

func printRegistryUsage() {
	fmt.Println("Usage: prompd registry <command> [options]")
	fmt.Println("")
	fmt.Println("Registry management commands:")
	fmt.Println("  list                     List all configured registries")
	fmt.Println("  add <name> <url>         Add a new registry")
	fmt.Println("  remove <name> [--force]  Remove a registry")
	fmt.Println("  set-default <name>       Set the default registry")
	fmt.Println("")
	fmt.Println("Registry operations:")
	fmt.Println("  login [-r <registry>] -t <token>  Authenticate with registry")
	fmt.Println("  logout [-r <registry>]            Clear authentication")
	fmt.Println("  search <query> [-r <registry>]    Search packages")
	fmt.Println("  info <package> [-r <registry>]    Get package information")
	fmt.Println("  publish [--registry <name>]       Publish package")
	fmt.Println("  install <package> [-r <registry>] Install package")
	fmt.Println("  versions <package> [-r <registry>] List package versions")
}

// Registry Management Commands

func handleRegistryList() {
	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	registries := getRegistriesMap(config)
	defaultRegistry := ""
	if def, exists := config.Registry["default"]; exists {
		if defStr, ok := def.(string); ok {
			defaultRegistry = defStr
		}
	}

	if len(registries) == 0 {
		fmt.Println("No registries configured")
		fmt.Println("Use 'prompd registry add' to add a registry")
		return
	}

	fmt.Println("Configured Registries:")
	for name, regData := range registries {
		defaultMark := ""
		if name == defaultRegistry {
			defaultMark = " (default)"
		}

		url := "N/A"
		username := "Not logged in"

		if regMap, ok := regData.(map[string]interface{}); ok {
			if urlVal, exists := regMap["url"]; exists {
				if urlStr, ok := urlVal.(string); ok {
					url = urlStr
				}
			}
			if usernameVal, exists := regMap["username"]; exists {
				if usernameStr, ok := usernameVal.(string); ok {
					username = usernameStr
				}
			}
		}

		fmt.Printf("  • %s%s\n", name, defaultMark)
		fmt.Printf("    URL: %s\n", url)
		fmt.Printf("    User: %s\n", username)
	}
}

func handleRegistryAdd() {
	if len(os.Args) < 5 {
		fmt.Println("Usage: prompd registry add <name> <url>")
		os.Exit(1)
	}

	name := os.Args[3]
	url := os.Args[4]

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	if err := addRegistry(config, name, url); err != nil {
		fmt.Printf("Error adding registry: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Added registry '%s' at %s\n", name, url)
}

func handleRegistryRemove() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: prompd registry remove <name> [--force]")
		os.Exit(1)
	}

	name := os.Args[3]
	force := false

	// Check for --force flag
	for _, arg := range os.Args[4:] {
		if arg == "--force" {
			force = true
			break
		}
	}

	// Warn about removing prompdhub unless forced
	if name == "prompdhub" && !force {
		fmt.Println("Warning: Removing the main prompdhub registry")
		fmt.Println("Use --force to confirm, or consider setting a different default instead")
		os.Exit(1)
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	if err := removeRegistry(config, name); err != nil {
		fmt.Printf("Error removing registry: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Removed registry '%s'\n", name)
}

func handleRegistrySetDefault() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: prompd registry set-default <name>")
		os.Exit(1)
	}

	name := os.Args[3]

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	if err := setDefaultRegistry(config, name); err != nil {
		fmt.Printf("Error setting default registry: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Set '%s' as default registry\n", name)
}

// Authentication Commands

func handleRegistryLogin() {
	var registryName string
	var token string

	// Parse arguments
	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		case "-t", "--token":
			if i+1 < len(os.Args) {
				token = os.Args[i+1]
				i++
			}
		}
	}

	if token == "" {
		fmt.Println("Usage: prompd registry login [-r <registry>] -t <token>")
		os.Exit(1)
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Resolve registry name
	if registryName == "" {
		if def, exists := config.Registry["default"]; exists {
			if defStr, ok := def.(string); ok {
				registryName = defStr
			}
		}
		if registryName == "" {
			registryName = "prompdhub"
		}
	}

	// Get registry info
	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Authenticating with %s...\n", registryName)

	// Verify token by getting user profile
	resp, err := http.Get(fmt.Sprintf("%s/v1/user/me", regInfo.URL))
	if err != nil {
		fmt.Printf("Authentication failed: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	req, err := http.NewRequest("GET", fmt.Sprintf("%s/v1/user/me", regInfo.URL), nil)
	if err != nil {
		fmt.Printf("Authentication failed: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	client := &http.Client{}
	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Authentication failed: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		fmt.Println("Invalid token. Please check your API token.")
		os.Exit(1)
	} else if resp.StatusCode == 404 {
		fmt.Printf("User endpoint not found. Registry URL: %s\n", regInfo.URL)
		os.Exit(1)
	} else if resp.StatusCode >= 500 {
		fmt.Printf("Registry server error (%d). Please try again later.\n", resp.StatusCode)
		os.Exit(1)
	}

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Authentication failed: %s\n", string(body))
		os.Exit(1)
	}

	var userData map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&userData); err != nil {
		fmt.Printf("Invalid response from registry: %v\n", err)
		os.Exit(1)
	}

	username, ok := userData["username"].(string)
	if !ok {
		fmt.Println("Invalid response from registry: missing username")
		os.Exit(1)
	}

	// Save token
	if err := setRegistryToken(config, registryName, token, username); err != nil {
		fmt.Printf("Error saving token: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Successfully authenticated as %s\n", username)
	fmt.Printf("   Registry: %s (%s)\n", registryName, regInfo.URL)
}

func handleRegistryLogout() {
	var registryName string

	// Parse arguments
	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Resolve registry name
	if registryName == "" {
		if def, exists := config.Registry["default"]; exists {
			if defStr, ok := def.(string); ok {
				registryName = defStr
			}
		}
		if registryName == "" {
			registryName = "prompdhub"
		}
	}

	// Clear token
	if err := setRegistryToken(config, registryName, "", ""); err != nil {
		fmt.Printf("Error clearing token: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Successfully logged out from %s\n", registryName)
}

// Registry Operation Commands

func handleRegistrySearch() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: prompd registry search <query> [-r <registry>]")
		os.Exit(1)
	}

	query := os.Args[3]
	var registryName string

	// Parse optional registry argument
	for i := 4; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Resolve registry name
	if registryName == "" {
		if def, exists := config.Registry["default"]; exists {
			if defStr, ok := def.(string); ok {
				registryName = defStr
			}
		}
		if registryName == "" {
			registryName = "prompdhub"
		}
	}

	// Get registry info
	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	// Perform search
	url := fmt.Sprintf("%s/v1/packages?q=%s", regInfo.URL, query)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Printf("Search failed: %v\n", err)
		os.Exit(1)
	}

	if regInfo.Token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", regInfo.Token))
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Search failed: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Search failed (%d): %s\n", resp.StatusCode, string(body))
		os.Exit(1)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fmt.Printf("Invalid response: %v\n", err)
		os.Exit(1)
	}

	packages, ok := result["packages"].([]interface{})
	if !ok {
		fmt.Printf("Invalid response format\n")
		os.Exit(1)
	}

	if len(packages) == 0 {
		fmt.Printf("No packages found for: %s\n", query)
		if registryName != "prompdhub" {
			fmt.Printf("Searched in registry: %s\n", registryName)
		}
		return
	}

	fmt.Printf("Found %d package(s) for '%s' in %s:\n\n", len(packages), query, registryName)

	for _, pkgData := range packages {
		if pkgMap, ok := pkgData.(map[string]interface{}); ok {
			name := getString(pkgMap, "name", "Unknown")
			version := getString(pkgMap, "version", "0.0.0")
			description := getString(pkgMap, "description", "No description available")
			author := getString(pkgMap, "author", "")

			fmt.Printf("%s - v%s\n", name, version)
			fmt.Printf("  %s\n", description)
			if author != "" {
				fmt.Printf("  Author: %s\n", author)
			}
			fmt.Println()
		}
	}
}

func handleRegistryInfo() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: prompd registry info <package> [-r <registry>]")
		os.Exit(1)
	}

	packageName := os.Args[3]
	var registryName string

	// Parse optional registry argument
	for i := 4; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Auto-resolve registry if not specified
	if registryName == "" {
		registryName = resolveRegistryForPackage(config, packageName)
	}

	// Get registry info
	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	// Get package info
	url := fmt.Sprintf("%s/v1/packages/%s", regInfo.URL, packageName)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		os.Exit(1)
	}

	if regInfo.Token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", regInfo.Token))
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		fmt.Printf("Package not found: %s\n", packageName)
		os.Exit(1)
	}

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Request failed (%d): %s\n", resp.StatusCode, string(body))
		os.Exit(1)
	}

	var pkgInfo map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&pkgInfo); err != nil {
		fmt.Printf("Invalid response: %v\n", err)
		os.Exit(1)
	}

	// Display package information
	name := getString(pkgInfo, "name", "Unknown")
	version := getString(pkgInfo, "version", "0.0.0")
	description := getString(pkgInfo, "description", "No description")
	author := getString(pkgInfo, "author", "Unknown")
	license := getString(pkgInfo, "license", "Unknown")

	fmt.Printf("Package: %s v%s\n", name, version)
	fmt.Printf("Description: %s\n", description)
	fmt.Printf("Author: %s\n", author)
	fmt.Printf("License: %s\n", license)
	fmt.Printf("Registry: %s\n", registryName)
}

func handleRegistryPublish() {
	var registryName string

	// Parse optional registry argument
	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Resolve registry name
	if registryName == "" {
		if def, exists := config.Registry["default"]; exists {
			if defStr, ok := def.(string); ok {
				registryName = defStr
			}
		}
		if registryName == "" {
			registryName = "prompdhub"
		}
	}

	// Get registry info
	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	if regInfo.Token == "" {
		fmt.Printf("Not authenticated with registry '%s'. Use 'prompd registry login -r %s -t <token>' first.\n", registryName, registryName)
		os.Exit(1)
	}

	fmt.Printf("Publishing to registry: %s (%s)\n", registryName, regInfo.URL)
	fmt.Println("Note: Publish implementation requires package files - placeholder for now")
}

func handleRegistryInstall() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: prompd registry install <package> [-r <registry>]")
		os.Exit(1)
	}

	packageName := os.Args[3]
	var registryName string

	// Parse optional registry argument
	for i := 4; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Auto-resolve registry if not specified
	if registryName == "" {
		registryName = resolveRegistryForPackage(config, packageName)
	}

	// Get registry info
	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Installing package: %s\n", packageName)
	fmt.Printf("   Registry: %s (%s)\n", registryName, regInfo.URL)
	fmt.Println("Note: Install implementation requires download logic - placeholder for now")
}

func handleRegistryVersions() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: prompd registry versions <package> [-r <registry>]")
		os.Exit(1)
	}

	packageName := os.Args[3]
	var registryName string

	// Parse optional registry argument
	for i := 4; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-r", "--registry":
			if i+1 < len(os.Args) {
				registryName = os.Args[i+1]
				i++
			}
		}
	}

	config, err := LoadConfig()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Auto-resolve registry if not specified
	if registryName == "" {
		registryName = resolveRegistryForPackage(config, packageName)
	}

	// Get registry info
	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Versions for package: %s\n", packageName)
	fmt.Printf("   Registry: %s (%s)\n", registryName, regInfo.URL)
	fmt.Println("Note: Versions implementation requires API call - placeholder for now")
}

// Helper function to safely get string from map
func getString(m map[string]interface{}, key, defaultVal string) string {
	if val, exists := m[key]; exists {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return defaultVal
}

// getPackageInfo fetches package information from registry
func getPackageInfo(packageName string, registryName string) (*PackageInfo, error) {
	config, err := LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		return nil, err
	}

	// Construct API URL
	url := fmt.Sprintf("%s/packages/%s", regInfo.URL, packageName)

	// Make HTTP request
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add authentication if available
	if regInfo.Token != "" {
		req.Header.Set("Authorization", "Bearer "+regInfo.Token)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch package info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("registry returned status %d: %s", resp.StatusCode, string(body))
	}

	var info PackageInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &info, nil
}

// getPackageVersions fetches available versions for a package
func getPackageVersions(packageName string, registryName string) ([]string, error) {
	config, err := LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	regInfo, err := getRegistryInfo(config, registryName)
	if err != nil {
		return nil, err
	}

	// Construct API URL
	url := fmt.Sprintf("%s/packages/%s/versions", regInfo.URL, packageName)

	// Make HTTP request
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add authentication if available
	if regInfo.Token != "" {
		req.Header.Set("Authorization", "Bearer "+regInfo.Token)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch versions: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("registry returned status %d: %s", resp.StatusCode, string(body))
	}

	var versions []string
	if err := json.NewDecoder(resp.Body).Decode(&versions); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return versions, nil
}