"""
Comprehensive test suite for section override functionality.

Tests all aspects of the section-based content override system including:
- Section extraction and parsing
- Override validation
- Content merging
- CLI integration
- Error handling
"""

import pytest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock

from prompd.section_override_processor import SectionOverrideProcessor, SectionInfo
from prompd.parser import PrompdParser
from prompd.exceptions import ParseError, ValidationError
from prompd.models import PrompdMetadata


class TestSectionOverrideProcessor:
    """Test the core SectionOverrideProcessor functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.processor = SectionOverrideProcessor()

    def test_extract_sections_basic(self):
        """Test basic section extraction from markdown content."""
        content = """# System Prompt
You are a helpful assistant.

# Analysis Framework
Follow these steps:
1. Read carefully
2. Analyze thoroughly

# Examples
Here are some examples:
- Example 1
- Example 2
"""

        sections = self.processor.extract_sections(content)

        assert len(sections) == 3
        assert "system-prompt" in sections
        assert "analysis-framework" in sections
        assert "examples" in sections

        # Check section content
        system_section = sections["system-prompt"]
        assert system_section.id == "system-prompt"
        assert system_section.heading_text == "System Prompt"
        assert "You are a helpful assistant" in system_section.content
        assert system_section.heading_level == 1

    def test_extract_sections_with_explicit_ids(self):
        """Test section extraction with explicit section ID comments."""
        content = """<!-- section-id: custom-system -->
# System Prompt
You are a helpful assistant.

<!-- section-id: analysis-method -->
# Analysis Framework
Follow these steps carefully.
"""

        sections = self.processor.extract_sections(content)

        assert len(sections) == 2
        assert "custom-system" in sections
        assert "analysis-method" in sections

        assert sections["custom-system"].heading_text == "System Prompt"
        assert sections["analysis-method"].heading_text == "Analysis Framework"

    def test_extract_sections_mixed_heading_levels(self):
        """Test section extraction with different heading levels."""
        content = """# Main Section
Top level content.

## Sub Section
Sub level content.

### Deep Section
Deep level content.

# Another Main
More main content.
"""

        sections = self.processor.extract_sections(content)

        assert len(sections) == 4
        assert sections["main-section"].heading_level == 1
        assert sections["sub-section"].heading_level == 2
        assert sections["deep-section"].heading_level == 3
        assert sections["another-main"].heading_level == 1

    def test_extract_sections_empty_content(self):
        """Test section extraction with empty or whitespace content."""
        assert self.processor.extract_sections("") == {}
        assert self.processor.extract_sections("   \n  \n  ") == {}
        assert self.processor.extract_sections("No sections here") == {}

    def test_extract_sections_duplicate_ids_error(self):
        """Test that duplicate section IDs raise an error."""
        content = """# System Prompt
First system.

# System Prompt
Duplicate system prompt.
"""

        with pytest.raises(ParseError) as exc_info:
            self.processor.extract_sections(content)

        assert "Duplicate section ID" in str(exc_info.value)
        assert "system-prompt" in str(exc_info.value)

    def test_generate_section_id(self):
        """Test section ID generation from heading text."""
        test_cases = [
            ("System Prompt", "system-prompt"),
            ("Analysis Framework", "analysis-framework"),
            ("API Documentation", "api-documentation"),
            ("User Input/Output", "user-input-output"),
            ("Special!@#$%Characters", "special-characters"),
            ("Multiple   Spaces", "multiple-spaces"),
            ("123 Numbers", "123-numbers"),
            ("", "untitled-section"),
            ("   ", "untitled-section"),
        ]

        for heading, expected in test_cases:
            result = self.processor._generate_section_id(heading)
            assert result == expected, f"Failed for '{heading}': got '{result}', expected '{expected}'"

    def test_validate_section_id_valid(self):
        """Test validation of valid section IDs."""
        valid_ids = [
            "system-prompt",
            "analysis-framework",
            "simple",
            "with-numbers-123",
            "a",
            "a-b-c-d-e",
        ]

        for section_id in valid_ids:
            # Should not raise any exception
            self.processor._validate_section_id(section_id, 1)

    def test_validate_section_id_invalid(self):
        """Test validation of invalid section IDs."""
        invalid_cases = [
            ("", "Empty section ID"),
            ("UPPERCASE", "kebab-case"),
            ("with_underscores", "kebab-case"),
            ("with spaces", "kebab-case"),
            ("with@symbols", "kebab-case"),
            ("-leading-hyphen", "cannot start or end with hyphens"),
            ("trailing-hyphen-", "cannot start or end with hyphens"),
            ("double--hyphens", "consecutive hyphens"),
        ]

        for section_id, expected_error in invalid_cases:
            with pytest.raises(ParseError) as exc_info:
                self.processor._validate_section_id(section_id, 1)
            assert expected_error.lower() in str(exc_info.value).lower()

    def test_validate_overrides_against_parent_valid(self):
        """Test validation of valid overrides against parent sections."""
        parent_sections = {
            "system-prompt": SectionInfo("system-prompt", "System Prompt", "content", 0, 5, 1),
            "examples": SectionInfo("examples", "Examples", "content", 6, 10, 1),
            "analysis": SectionInfo("analysis", "Analysis", "content", 11, 15, 1),
        }

        overrides = {
            "system-prompt": "./custom-system.md",
            "examples": None,  # Remove section
        }

        warnings = self.processor.validate_overrides_against_parent(overrides, parent_sections)
        assert warnings == []

    def test_validate_overrides_against_parent_invalid(self):
        """Test validation of invalid overrides against parent sections."""
        parent_sections = {
            "system-prompt": SectionInfo("system-prompt", "System Prompt", "content", 0, 5, 1),
            "examples": SectionInfo("examples", "Examples", "content", 6, 10, 1),
        }

        overrides = {
            "nonexistent-section": "./custom.md",
            "system-promtp": "./typo.md",  # Typo
        }

        warnings = self.processor.validate_overrides_against_parent(overrides, parent_sections)

        assert len(warnings) == 2
        assert "nonexistent-section" in warnings[0]
        assert "system-promtp" in warnings[1]
        assert "Did you mean: system-prompt" in warnings[1]

    def test_find_similar_section_ids(self):
        """Test finding similar section IDs for typo suggestions."""
        available = {"system-prompt", "analysis-framework", "examples", "user-input"}

        # Exact matches and close typos
        test_cases = [
            ("system-promtp", ["system-prompt"]),  # Typo
            ("analysis", ["analysis-framework"]),  # Better partial match
            ("example", ["examples"]),  # Singular vs plural
            ("completely-different", []),  # No close matches
            ("user", ["user-input"]),  # Partial match
        ]

        for target, expected in test_cases:
            similar = self.processor._find_similar_section_ids(target, available)
            if expected:
                assert len(similar) > 0
                assert expected[0] in similar
            else:
                assert len(similar) == 0

    def test_load_override_content_success(self):
        """Test successful loading of override content from file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create test file
            override_file = temp_path / "custom-content.md"
            override_content = "# Custom System Prompt\nThis is custom content."
            override_file.write_text(override_content, encoding='utf-8')

            # Load content
            loaded_content = self.processor.load_override_content("custom-content.md", temp_path)

            assert loaded_content == override_content.strip()

    def test_load_override_content_file_not_found(self):
        """Test loading override content from non-existent file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            with pytest.raises(ValidationError) as exc_info:
                self.processor.load_override_content("nonexistent.md", temp_path)

            assert "not found" in str(exc_info.value)

    def test_load_override_content_security_check(self):
        """Test security check preventing path traversal."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Try to access file outside base directory
            with pytest.raises(ValidationError) as exc_info:
                self.processor.load_override_content("../../../etc/passwd", temp_path)

            assert "outside the base directory" in str(exc_info.value)

    def test_load_override_content_file_size_limit(self):
        """Test file size limit security control."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create a file larger than 1MB
            large_file = temp_path / "large_file.md"
            large_content = "x" * (1024 * 1024 + 1)  # 1MB + 1 byte
            large_file.write_text(large_content)

            with pytest.raises(ValidationError) as exc_info:
                self.processor.load_override_content("large_file.md", temp_path)

            assert "exceeds maximum size limit" in str(exc_info.value)
            assert "1024KB" in str(exc_info.value)

    def test_load_override_content_symlink_protection(self):
        """Test symlink protection security control."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create a regular file
            real_file = temp_path / "real_file.md"
            real_file.write_text("# Real Content\nThis is real content.")

            # Create a symlink to it
            symlink_file = temp_path / "symlink_file.md"
            try:
                symlink_file.symlink_to(real_file)

                with pytest.raises(ValidationError) as exc_info:
                    self.processor.load_override_content("symlink_file.md", temp_path)

                assert "symbolic links" in str(exc_info.value)
                assert "security reasons" in str(exc_info.value)
            except OSError:
                # Skip test if symlinks not supported on this platform
                pytest.skip("Symlinks not supported on this platform")

    def test_load_override_content_sanitized_error_messages(self):
        """Test that error messages don't leak sensitive path information."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Test with nonexistent file
            with pytest.raises(ValidationError) as exc_info:
                self.processor.load_override_content("nonexistent.md", temp_path)

            error_msg = str(exc_info.value)
            # Should contain user path but not system paths
            assert "nonexistent.md" in error_msg
            assert temp_dir not in error_msg  # Internal path should be sanitized
            assert "verify the file exists" in error_msg

    def test_load_override_content_encoding_detection(self):
        """Test automatic encoding detection for override files."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Test UTF-8 with BOM
            utf8_bom_file = temp_path / "utf8-bom.md"
            content = "# UTF-8 with BOM\nSpecial chars: àáâã"
            utf8_bom_file.write_text(content, encoding='utf-8-sig')

            loaded = self.processor.load_override_content("utf8-bom.md", temp_path)
            assert "Special chars: àáâã" in loaded

    def test_apply_overrides_complete_workflow(self):
        """Test the complete override application workflow."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create parent sections
            parent_sections = {
                "system-prompt": SectionInfo(
                    "system-prompt", "System Prompt",
                    "# System Prompt\nYou are a helpful assistant.", 0, 2, 1
                ),
                "examples": SectionInfo(
                    "examples", "Examples",
                    "# Examples\nExample 1\nExample 2", 3, 5, 1
                ),
                "analysis": SectionInfo(
                    "analysis", "Analysis",
                    "# Analysis\nAnalyze carefully.", 6, 7, 1
                ),
            }

            # Create child sections
            child_sections = {
                "custom-section": SectionInfo(
                    "custom-section", "Custom Section",
                    "# Custom Section\nChild-specific content.", 0, 1, 1
                )
            }

            # Create override files
            override_file = temp_path / "custom-system.md"
            override_file.write_text("You are a specialized security analyst.", encoding='utf-8')

            # Define overrides
            overrides = {
                "system-prompt": "./custom-system.md",  # Replace
                "examples": None,  # Remove
                # analysis: keep from parent
            }

            # Apply overrides
            result = self.processor.apply_overrides(
                parent_sections=parent_sections,
                child_sections=child_sections,
                overrides=overrides,
                base_dir=temp_path,
                verbose=False
            )

            # Verify result
            assert "specialized security analyst" in result
            assert "Example 1" not in result  # Examples removed
            assert "Analyze carefully" in result  # Analysis kept
            assert "Custom Section" in result  # Child section added

    def test_apply_overrides_error_handling(self):
        """Test error handling in override application."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            parent_sections = {
                "system-prompt": SectionInfo(
                    "system-prompt", "System Prompt",
                    "# System Prompt\nOriginal content.", 0, 1, 1
                )
            }

            # Override referencing non-existent file
            overrides = {
                "system-prompt": "./missing-file.md"
            }

            with pytest.raises(ValidationError) as exc_info:
                self.processor.apply_overrides(
                    parent_sections=parent_sections,
                    child_sections={},
                    overrides=overrides,
                    base_dir=temp_path,
                    verbose=False
                )

            assert "missing-file.md" in str(exc_info.value)

    def test_get_section_summary(self):
        """Test getting section summary for display."""
        sections = {
            "system-prompt": SectionInfo(
                "system-prompt", "System Prompt",
                "Content" * 100, 0, 5, 1  # Long content
            ),
            "examples": SectionInfo(
                "examples", "Examples",
                "Short", 6, 7, 1  # Short content
            ),
        }

        summary = self.processor.get_section_summary(sections)

        assert len(summary) == 2

        # Should be sorted by section ID
        assert summary[0][0] == "examples"  # Comes first alphabetically
        assert summary[1][0] == "system-prompt"

        # Check content lengths
        assert summary[0][2] == 5  # "Short" length
        assert summary[1][2] == 700  # "Content" * 100 length


class TestPrompdParserIntegration:
    """Test integration between parser and section override functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.parser = PrompdParser()

    def test_extract_sections_from_file(self):
        """Test extracting sections from a .prmd file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False) as f:
            content = """---
name: test-template
description: Test template
---

# System Prompt
You are a helpful assistant.

# Examples
Example content here.
"""
            f.write(content)
            f.flush()
            temp_file = Path(f.name)

        try:
            sections = self.parser.extract_sections_from_file(temp_file)

            assert len(sections) == 2
            assert "system-prompt" in sections
            assert "examples" in sections

        finally:
            temp_file.unlink()

    def test_get_section_summary_from_file(self):
        """Test getting section summary from a .prmd file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False) as f:
            content = """---
name: test-template
---

# System Guidelines
You are a security analyst.

# Analysis Framework
Follow these steps:
1. Step one
2. Step two
"""
            f.write(content)
            f.flush()
            temp_file = Path(f.name)

        try:
            summary = self.parser.get_section_summary(temp_file)

            assert len(summary) == 2
            assert summary[0][0] == "analysis-framework"  # Alphabetically first
            assert summary[0][1] == "Analysis Framework"
            assert summary[1][0] == "system-guidelines"
            assert summary[1][1] == "System Guidelines"

        finally:
            temp_file.unlink()

    def test_validate_overrides_against_parent_integration(self):
        """Test complete override validation workflow."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create parent template
            parent_file = temp_path / "parent.prmd"
            parent_content = """---
name: parent-template
---

# System Prompt
Parent system prompt.

# Examples
Parent examples.
"""
            parent_file.write_text(parent_content, encoding='utf-8')

            # Create child template
            child_file = temp_path / "child.prmd"
            child_content = """---
name: child-template
inherits: "./parent.prmd"
override:
  system-prompt: "./custom-system.md"
  nonexistent-section: "./custom.md"
---

# Custom Content
Child-specific content.
"""
            child_file.write_text(child_content, encoding='utf-8')

            # Validate overrides
            warnings = self.parser.validate_overrides_against_parent(child_file, parent_file)

            assert len(warnings) == 1
            assert "nonexistent-section" in warnings[0]
            assert "system-prompt" not in warnings[0]  # Valid override


class TestCLIIntegration:
    """Test CLI command integration with section override functionality."""

    def test_show_sections_command_mock(self):
        """Test the show command with --sections flag (mocked)."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False) as f:
            content = """---
name: test-template
---

# System Prompt
You are a helpful assistant.

# Examples
Example content.
"""
            f.write(content)
            f.flush()
            temp_file = Path(f.name)

        try:
            # Mock the CLI functionality
            from prompd.cli import show
            from click.testing import CliRunner

            runner = CliRunner()
            result = runner.invoke(show, [str(temp_file), '--sections'])

            assert result.exit_code == 0
            assert "Available Sections for Override" in result.output
            assert "system-prompt" in result.output
            assert "examples" in result.output

        finally:
            temp_file.unlink()

    def test_validate_check_overrides_command_mock(self):
        """Test the validate command with --check-overrides flag (mocked)."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create parent
            parent_file = temp_path / "parent.prmd"
            parent_content = """---
name: parent
---

# System Prompt
Parent content.
"""
            parent_file.write_text(parent_content, encoding='utf-8')

            # Create child with valid overrides
            child_file = temp_path / "child.prmd"
            child_content = """---
name: child
inherits: "./parent.prmd"
override:
  system-prompt: "./custom.md"
---

Child content.
"""
            child_file.write_text(child_content, encoding='utf-8')

            # Create override content file
            custom_file = temp_path / "custom.md"
            custom_file.write_text("Custom system prompt", encoding='utf-8')

            # Mock the CLI functionality
            from prompd.cli import validate
            from click.testing import CliRunner

            runner = CliRunner()
            result = runner.invoke(validate, [str(child_file), '--check-overrides', '--verbose'])

            assert result.exit_code == 0  # Should pass validation


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def setup_method(self):
        """Set up test fixtures."""
        self.processor = SectionOverrideProcessor()

    def test_malformed_section_comments(self):
        """Test handling of malformed section ID comments."""
        content = """<!-- section-id: INVALID_ID -->
# System Prompt
Content here.

<!-- section-id: -->
# Empty ID
More content.

<!-- not-section-id: ignored -->
# Regular Heading
Regular content.
"""

        with pytest.raises(ParseError) as exc_info:
            self.processor.extract_sections(content)

        # Should fail on first invalid ID
        assert "INVALID_ID" in str(exc_info.value)

    def test_very_long_content(self):
        """Test handling of very long content sections."""
        long_content = "A" * 100000  # 100KB of content
        content = f"""# System Prompt
{long_content}

# Examples
Short content.
"""

        sections = self.processor.extract_sections(content)

        assert len(sections) == 2
        assert len(sections["system-prompt"].content) > 100000
        assert "AAAA" in sections["system-prompt"].content

    def test_unicode_content(self):
        """Test handling of Unicode content in sections."""
        content = """# Système de Prompt
Vous êtes un assistant français. 中文测试 🚀

# Exemples
Émojis work: 📝 ✅ 🎯
Unicode chars: àáâãäåæçèéêë
"""

        sections = self.processor.extract_sections(content)

        assert "système-de-prompt" in sections
        assert "exemples" in sections
        assert "français" in sections["système-de-prompt"].content
        assert "🚀" in sections["système-de-prompt"].content
        assert "📝" in sections["exemples"].content

    def test_concurrent_section_processing(self):
        """Test that section processing is thread-safe."""
        import threading
        import time

        content = """# System Prompt
Thread test content.

# Examples
More content for threading test.
"""

        results = []
        errors = []

        def process_sections():
            try:
                processor = SectionOverrideProcessor()
                sections = processor.extract_sections(content)
                results.append(len(sections))
            except Exception as e:
                errors.append(e)

        # Run multiple threads
        threads = []
        for _ in range(10):
            thread = threading.Thread(target=process_sections)
            threads.append(thread)
            thread.start()

        # Wait for all threads
        for thread in threads:
            thread.join()

        # Check results
        assert len(errors) == 0, f"Errors occurred: {errors}"
        assert len(results) == 10
        assert all(r == 2 for r in results), f"Inconsistent results: {results}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])