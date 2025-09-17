"""
Modular shell package for Prompd CLI.
Provides interactive shell and conversational AI assistance.
"""

from .assistant import ConversationalAssistant
from .interactive import PrompdShell

# Main interface class for external use
class InteractiveShell:
    """Main interactive shell interface."""
    
    def __init__(self):
        from rich.console import Console
        self.console = Console()
        self.shell = PrompdShell()
    
    def run(self):
        """Start the interactive shell."""
        self.shell.run()
    
    def run_chat_mode(self):
        """Start chat mode directly."""
        self.shell.run_chat_mode()


# Convenience function for backward compatibility
def start_prompd_shell():
    """Start the Prompd shell - convenience function."""
    shell = InteractiveShell()
    shell.run()


__all__ = ['ConversationalAssistant', 'PrompdShell', 'InteractiveShell', 'start_prompd_shell']