"""Prompd exceptions."""


class PrompdError(Exception):
    """Base exception for Prompd errors."""
    pass


class ParseError(PrompdError):
    """Error parsing .prmd file."""
    pass


class ValidationError(PrompdError):
    """Error validating parameters or structure."""
    pass


class SubstitutionError(PrompdError):
    """Error during variable substitution."""
    pass


class ProviderError(PrompdError):
    """Error from LLM provider."""
    pass


class ConfigurationError(PrompdError):
    """Error in configuration."""
    pass