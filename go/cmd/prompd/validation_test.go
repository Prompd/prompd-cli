package main

import (
	"runtime"
	"testing"
)

func TestValidatePackageName(t *testing.T) {
	tests := []struct {
		name      string
		pkgName   string
		shouldErr bool
	}{
		{name: "valid scoped", pkgName: "@prompd/core", shouldErr: false},
		{name: "valid with dash", pkgName: "@my-org/my-pkg", shouldErr: false},
		{name: "valid with numbers", pkgName: "@org123/pkg456", shouldErr: false},
		{name: "missing scope", pkgName: "package", shouldErr: true},
		{name: "invalid uppercase", pkgName: "@Org/Package", shouldErr: true},
		{name: "traversal attempt", pkgName: "@org/../evil", shouldErr: true},
		{name: "empty", pkgName: "", shouldErr: true},
		{name: "no namespace", pkgName: "@/package", shouldErr: true},
		{name: "no package name", pkgName: "@namespace/", shouldErr: true},
		{name: "double slash", pkgName: "@org//pkg", shouldErr: true},
		{name: "too long", pkgName: "@" + string(make([]byte, 250)), shouldErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePackageName(tt.pkgName)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v", tt.shouldErr, err)
			}
		})
	}
}

func TestValidateVersion(t *testing.T) {
	tests := []struct {
		name      string
		version   string
		shouldErr bool
	}{
		{name: "valid", version: "1.0.0", shouldErr: false},
		{name: "valid major", version: "2.0.0", shouldErr: false},
		{name: "valid with large numbers", version: "10.20.30", shouldErr: false},
		{name: "invalid two parts", version: "1.0", shouldErr: true},
		{name: "invalid with v prefix", version: "v1.0.0", shouldErr: true},
		{name: "invalid with prerelease", version: "1.0.0-alpha", shouldErr: true},
		{name: "invalid with build", version: "1.0.0+build", shouldErr: true},
		{name: "empty", version: "", shouldErr: true},
		{name: "invalid negative", version: "-1.0.0", shouldErr: true},
		{name: "invalid letters", version: "a.b.c", shouldErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVersion(tt.version)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v", tt.shouldErr, err)
			}
		})
	}
}

func TestValidateRegistryURL(t *testing.T) {
	tests := []struct {
		name      string
		url       string
		shouldErr bool
	}{
		{name: "valid https", url: "https://registry.prompdhub.ai", shouldErr: false},
		{name: "localhost http ok", url: "http://localhost:4000", shouldErr: false},
		{name: "127.0.0.1 http ok", url: "http://127.0.0.1:4000", shouldErr: false},
		{name: "ipv6 localhost ok", url: "http://[::1]:4000", shouldErr: false},
		{name: "invalid http", url: "http://example.com", shouldErr: true},
		{name: "invalid format", url: "not-a-url", shouldErr: true},
		{name: "empty", url: "", shouldErr: true},
		{name: "no host", url: "https://", shouldErr: true},
		{name: "suspicious pattern", url: "https://example.com/../evil", shouldErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRegistryURL(tt.url)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v for URL: %s", tt.shouldErr, err, tt.url)
			}
		})
	}
}

func TestSanitizeFilePath(t *testing.T) {
	absPath := "/etc/passwd"
	if runtime.GOOS == "windows" {
		absPath = `C:\Windows\System32`
	}

	tests := []struct {
		name      string
		path      string
		basePath  string
		shouldErr bool
	}{
		{name: "simple relative", path: "file.txt", basePath: "", shouldErr: false},
		{name: "relative with dir", path: "dir/file.txt", basePath: "", shouldErr: false},
		{name: "absolute path", path: absPath, basePath: "", shouldErr: true},
		{name: "traversal up", path: "../etc/passwd", basePath: "", shouldErr: true},
		{name: "traversal in path", path: "dir/../../../etc/passwd", basePath: "", shouldErr: true},
		{name: "null byte", path: "file\x00.txt", basePath: "", shouldErr: true},
		{name: "within base", path: "subdir/file.txt", basePath: "/tmp", shouldErr: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := sanitizeFilePath(tt.path, tt.basePath)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v for path: %s", tt.shouldErr, err, tt.path)
			}
		})
	}
}

func TestIsSecurePath(t *testing.T) {
	absPath := "/etc/passwd"
	basePath := "/tmp"
	if runtime.GOOS == "windows" {
		absPath = `C:\Windows\System32`
		basePath = t.TempDir()
	}

	tests := []struct {
		name      string
		path      string
		basePath  string
		shouldErr bool
	}{
		{name: "simple relative", path: "file.txt", basePath: basePath, shouldErr: false},
		{name: "relative with dir", path: "dir/file.txt", basePath: basePath, shouldErr: false},
		{name: "absolute path", path: absPath, basePath: basePath, shouldErr: true},
		{name: "traversal up", path: "../etc/passwd", basePath: basePath, shouldErr: true},
		{name: "traversal in middle", path: "dir/../../../etc/passwd", basePath: basePath, shouldErr: true},
		{name: "null byte", path: "file\x00.txt", basePath: basePath, shouldErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := isSecurePath(tt.path, tt.basePath)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v for path: %s", tt.shouldErr, err, tt.path)
			}
		})
	}
}

func TestIsMaliciousContent(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected bool
	}{
		{name: "safe content", content: "This is safe text", expected: false},
		{name: "eval", content: "eval('malicious code')", expected: true},
		{name: "exec", content: "exec('rm -rf /')", expected: true},
		{name: "os.system", content: "os.system('whoami')", expected: true},
		{name: "script tag", content: "<script>alert('xss')</script>", expected: true},
		{name: "javascript url", content: "javascript:void(0)", expected: true},
		{name: "cmd", content: "cmd /c del *", expected: true},
		{name: "powershell", content: "powershell -encodedcommand", expected: true},
		{name: "base64 decode", content: "echo abc | base64 -d", expected: true},
		{name: "chmod", content: "chmod +x malware.sh", expected: true},
		{name: "shell paths", content: "cat /bin/bash", expected: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isMaliciousContent(tt.content)
			if result != tt.expected {
				t.Errorf("expected %v, got %v for content: %s", tt.expected, result, tt.content)
			}
		})
	}
}

func TestValidateDescription(t *testing.T) {
	tests := []struct {
		name      string
		desc      string
		shouldErr bool
	}{
		{name: "valid short", desc: "A simple package", shouldErr: false},
		{name: "valid long", desc: string(make([]byte, 400)), shouldErr: false},
		{name: "too long", desc: string(make([]byte, 501)), shouldErr: true},
		{name: "empty", desc: "", shouldErr: true},
		{name: "malicious eval", desc: "eval('bad code')", shouldErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateDescription(tt.desc)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v", tt.shouldErr, err)
			}
		})
	}
}

func TestValidateAuthor(t *testing.T) {
	tests := []struct {
		name      string
		author    string
		shouldErr bool
	}{
		{name: "valid", author: "John Doe", shouldErr: false},
		{name: "valid email", author: "john@example.com", shouldErr: false},
		{name: "empty (optional)", author: "", shouldErr: false},
		{name: "too long", author: string(make([]byte, 201)), shouldErr: true},
		{name: "malicious", author: "eval('code')", shouldErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAuthor(tt.author)
			if (err != nil) != tt.shouldErr {
				t.Errorf("expected error: %v, got: %v", tt.shouldErr, err)
			}
		})
	}
}
