from importlib import resources
from typing import Optional


def read_prompt_asset(relative_path: str) -> Optional[str]:
    """Read a bundled .prmd asset from the installed package.

    Args:
        relative_path: Path relative to assets/prompts/, e.g. "cli/python/command-planner.prmd"

    Returns:
        The file content as a string if found, otherwise None.
    """
    base = "prompd.assets.prompts"
    try:
        files = resources.files(base)
        target = files.joinpath(relative_path)
        with target.open("r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None

