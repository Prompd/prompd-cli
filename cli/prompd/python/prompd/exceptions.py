"""Prompd exceptions."""


class PrompDError(Exception):
    """Base exception for Prompd errors."""
    pass


class ParseError(PrompDError):
    """Error parsing .prompd file."""
    pass


class ValidationError(PrompDError):
    """Error validating parameters or structure."""
    pass


class SubstitutionError(PrompDError):
    """Error during variable substitution."""
    pass


class ProviderError(PrompDError):
    """Error from LLM provider."""
    pass


class ConfigurationError(PrompDError):
    """Error in configuration."""
    pass