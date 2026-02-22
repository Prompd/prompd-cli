"""
Workflow Compiler for .pdflow files

Two-stage compilation architecture:
- Stage 1: Compile .prmd files, resolve packages, resolve inheritance - preserve runtime variables
- Stage 2: Substitute runtime values at execution time

Supports multiple output formats:
- pdflow-compiled: Native Prompd format for execution
- langflow: LangFlow compatible JSON
- n8n: n8n workflow format
- trim/plain: Minimal JSON without visual metadata
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .compiler import PrompdCompiler
from .exceptions import PrompdError


@dataclass
class CompiledStep:
    """A compiled workflow step with pre-processed prompt content."""
    id: str
    original_source: str
    compiled_prompt: str  # Compiled content with runtime vars preserved
    provider: Optional[str] = None
    model: Optional[str] = None
    parameters: Dict[str, str] = field(default_factory=dict)
    output_mapping: Dict[str, str] = field(default_factory=dict)
    node_type: str = "prompt"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CompiledWorkflow:
    """A fully compiled workflow ready for execution or export."""
    version: str
    compiled: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)
    parameters: List[Dict[str, Any]] = field(default_factory=list)
    steps: List[CompiledStep] = field(default_factory=list)
    edges: List[Dict[str, str]] = field(default_factory=list)
    variables: List[Dict[str, Any]] = field(default_factory=list)
    error_handling: Optional[Dict[str, Any]] = None
    execution_config: Optional[Dict[str, Any]] = None


class WorkflowCompiler:
    """
    Compiles .pdflow workflow files to various output formats.

    Two-stage compilation:
    1. Stage 1 (compile-time): Resolve packages, compile .prmd files, preserve runtime vars
    2. Stage 2 (runtime): Substitute runtime values during execution
    """

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.prompd_compiler = PrompdCompiler()

    def compile(
        self,
        workflow_path: Path,
        output_format: str = "pdflow-compiled",
        preserve_runtime_vars: bool = True,
        trim: bool = False,
        base_dir: Optional[Path] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Compile a .pdflow workflow file.

        Args:
            workflow_path: Path to the .pdflow file
            output_format: Target format (pdflow-compiled, langflow, n8n, trim)
            preserve_runtime_vars: Keep {{ }} runtime variables in compiled output
            trim: Remove visual/editor metadata (positions, colors, etc.)
            base_dir: Base directory for resolving relative paths

        Returns:
            Tuple of (compiled_output_string, metadata_dict)
        """
        if not workflow_path.exists():
            raise PrompdError(f"Workflow file not found: {workflow_path}")

        if workflow_path.suffix != ".pdflow":
            raise PrompdError(f"Expected .pdflow file, got: {workflow_path.suffix}")

        base_dir = base_dir or workflow_path.parent

        # Load workflow
        with open(workflow_path, encoding="utf-8") as f:
            workflow_data = json.load(f)

        if self.verbose:
            print(f"[workflow] Loaded workflow: {workflow_data.get('metadata', {}).get('name', 'unnamed')}")
            print(f"[workflow] Nodes: {len(workflow_data.get('nodes', []))}")

        # Stage 1: Compile all prompt nodes
        compiled = self._compile_workflow(workflow_data, base_dir, preserve_runtime_vars)

        # Generate output based on format
        if output_format == "langflow":
            output = self._to_langflow(compiled, trim)
        elif output_format == "n8n":
            output = self._to_n8n(compiled, trim)
        elif output_format in ("trim", "plain"):
            output = self._to_trim(compiled)
        else:  # pdflow-compiled (default)
            output = self._to_pdflow_compiled(compiled, trim)

        metadata = {
            "source_file": str(workflow_path),
            "output_format": output_format,
            "compiled_steps": len(compiled.steps),
            "preserved_runtime_vars": preserve_runtime_vars
        }

        return output, metadata

    def _compile_workflow(
        self,
        workflow_data: Dict[str, Any],
        base_dir: Path,
        preserve_runtime_vars: bool
    ) -> CompiledWorkflow:
        """
        Stage 1: Compile all nodes in the workflow.

        For prompt nodes:
        - Read the .prmd file
        - Compile with the prompd compiler (resolve packages, inheritance, assets)
        - Preserve runtime variables like {{ previous_output }}
        """
        compiled = CompiledWorkflow(
            version=workflow_data.get("version", "1.0"),
            metadata=workflow_data.get("metadata", {}),
            parameters=workflow_data.get("parameters", []),
            variables=workflow_data.get("variables", []),
            error_handling=workflow_data.get("errorHandling"),
            execution_config=workflow_data.get("execution")
        )

        nodes = workflow_data.get("nodes", [])
        edges = workflow_data.get("edges", [])

        # Convert edges to simple format
        compiled.edges = [
            {
                "id": edge.get("id", f"e-{edge['source']}-{edge['target']}"),
                "source": edge["source"],
                "target": edge["target"],
                "sourceHandle": edge.get("sourceHandle", "output"),
                "targetHandle": edge.get("targetHandle", "input"),
                "label": edge.get("label")
            }
            for edge in edges
        ]

        # Compile each node
        for node in nodes:
            node_type = node.get("type", "prompt")
            node_data = node.get("data", {})
            node_id = node["id"]

            if node_type == "prompt":
                step = self._compile_prompt_node(node, base_dir, preserve_runtime_vars)
            elif node_type == "condition":
                step = self._compile_condition_node(node)
            elif node_type == "loop":
                step = self._compile_loop_node(node)
            elif node_type == "parallel":
                step = self._compile_parallel_node(node)
            elif node_type == "callback":
                step = self._compile_callback_node(node)
            elif node_type == "output":
                step = self._compile_output_node(node)
            elif node_type == "transformer":
                step = self._compile_transformer_node(node)
            elif node_type == "api":
                step = self._compile_api_node(node)
            else:
                # Unknown node type - preserve as-is
                step = CompiledStep(
                    id=node_id,
                    original_source="",
                    compiled_prompt="",
                    node_type=node_type,
                    metadata=node_data
                )

            compiled.steps.append(step)

        return compiled

    def _compile_prompt_node(
        self,
        node: Dict[str, Any],
        base_dir: Path,
        preserve_runtime_vars: bool
    ) -> CompiledStep:
        """Compile a prompt node by reading and compiling its .prmd source."""
        node_id = node["id"]
        node_data = node.get("data", {})
        source = node_data.get("source", "")

        if self.verbose:
            print(f"[workflow] Compiling prompt node: {node_id} ({source})")

        compiled_prompt = ""
        original_source = source

        if source:
            try:
                # Resolve source path
                if source.startswith("@"):
                    # Package reference - use package resolver
                    from .package_resolver import PackageResolver
                    resolver = PackageResolver()
                    package_path = resolver.resolve_package(source)
                    prmd_file = self._find_main_prmd(package_path)
                else:
                    # Local file path
                    prmd_file = base_dir / source
                    if not prmd_file.exists():
                        prmd_file = Path(source)

                if prmd_file and prmd_file.exists():
                    # Create a parameters dict for compile-time substitution
                    # We DON'T substitute runtime vars - those stay as {{ }}
                    compile_time_params = {}

                    # Only substitute non-runtime parameters
                    node_params = node_data.get("parameters", {})
                    for key, value in node_params.items():
                        if isinstance(value, str) and not self._is_runtime_var(value):
                            compile_time_params[key] = value

                    # Compile the .prmd file
                    result = self.prompd_compiler.compile(
                        prmd_file,
                        output_format="markdown",
                        parameters=compile_time_params if not preserve_runtime_vars else {},
                        verbose=self.verbose
                    )

                    # Strip the PROMPD METADATA comment block if present
                    compiled_prompt = self._strip_metadata_comment(result)

                else:
                    compiled_prompt = f"[Error: Source file not found: {source}]"

            except Exception as e:
                if self.verbose:
                    print(f"[workflow] Warning: Failed to compile {source}: {e}")
                compiled_prompt = f"[Error compiling: {e}]"

        return CompiledStep(
            id=node_id,
            original_source=original_source,
            compiled_prompt=compiled_prompt,
            provider=node_data.get("provider"),
            model=node_data.get("model"),
            parameters=node_data.get("parameters", {}),
            output_mapping=node_data.get("outputMapping", {}),
            node_type="prompt",
            metadata={
                "label": node_data.get("label", ""),
                "position": node.get("position"),
                "context": node_data.get("context")
            }
        )

    def _compile_condition_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile a condition node - preserve expressions for runtime evaluation."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="condition",
            metadata={
                "label": node_data.get("label", ""),
                "conditions": node_data.get("conditions", []),
                "default": node_data.get("default"),
                "position": node.get("position")
            }
        )

    def _compile_loop_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile a loop node - preserve loop config for runtime."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="loop",
            metadata={
                "label": node_data.get("label", ""),
                "loopType": node_data.get("loopType"),
                "condition": node_data.get("condition"),
                "items": node_data.get("items"),
                "itemVariable": node_data.get("itemVariable"),
                "count": node_data.get("count"),
                "maxIterations": node_data.get("maxIterations", 10),
                "body": node_data.get("body", []),
                "onComplete": node_data.get("onComplete"),
                "position": node.get("position")
            }
        )

    def _compile_parallel_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile a parallel node."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="parallel",
            metadata={
                "label": node_data.get("label", ""),
                "branches": node_data.get("branches", []),
                "waitFor": node_data.get("waitFor", "all"),
                "mergeStrategy": node_data.get("mergeStrategy", "object"),
                "position": node.get("position")
            }
        )

    def _compile_callback_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile a callback/checkpoint node."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="callback",
            metadata={
                "label": node_data.get("label", ""),
                "mode": node_data.get("mode", "passthrough"),
                "checkpointName": node_data.get("checkpointName"),
                "message": node_data.get("message"),
                "includePreviousOutput": node_data.get("includePreviousOutput", True),
                "includeNextNodeInfo": node_data.get("includeNextNodeInfo", True),
                "webhookUrl": node_data.get("webhookUrl"),
                "waitForAck": node_data.get("waitForAck", False),
                "ackTimeoutMs": node_data.get("ackTimeoutMs", 0),
                "position": node.get("position")
            }
        )

    def _compile_output_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile an output node."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="output",
            metadata={
                "label": node_data.get("label", ""),
                "outputSchema": node_data.get("outputSchema"),
                "position": node.get("position")
            }
        )

    def _compile_transformer_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile a transformer node - preserve transform template."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="transformer",
            metadata={
                "label": node_data.get("label", ""),
                "transform": node_data.get("transform", ""),
                "position": node.get("position")
            }
        )

    def _compile_api_node(self, node: Dict[str, Any]) -> CompiledStep:
        """Compile an API node - preserve config for runtime."""
        node_data = node.get("data", {})
        return CompiledStep(
            id=node["id"],
            original_source="",
            compiled_prompt="",
            node_type="api",
            metadata={
                "label": node_data.get("label", ""),
                "method": node_data.get("method", "GET"),
                "url": node_data.get("url", ""),
                "headers": node_data.get("headers", {}),
                "body": node_data.get("body"),
                "retryPolicy": node_data.get("retryPolicy"),
                "position": node.get("position")
            }
        )

    def _is_runtime_var(self, value: str) -> bool:
        """Check if a value contains runtime variables ({{ }} expressions)."""
        return bool(re.search(r"\{\{.*?\}\}", value))

    def _strip_metadata_comment(self, content: str) -> str:
        """Strip the <!-- PROMPD METADATA --> comment block from compiled output."""
        pattern = r"<!--\s*PROMPD METADATA\s*\n.*?\n-->\s*\n*# Main Prompt Content\s*\n*"
        return re.sub(pattern, "", content, flags=re.DOTALL).strip()

    def _find_main_prmd(self, package_path: Path) -> Optional[Path]:
        """Find the main .prmd file in a package."""
        # Check prompd.json or manifest.json for main entry
        for manifest_name in ["prompd.json", "manifest.json"]:
            manifest_path = package_path / manifest_name
            if manifest_path.exists():
                with open(manifest_path) as f:
                    manifest = json.load(f)
                main = manifest.get("main")
                if main:
                    return package_path / main

        # Fallback: find first .prmd file
        prmd_files = list(package_path.glob("**/*.prmd"))
        return prmd_files[0] if prmd_files else None

    # ========================================================================
    # Output Format Generators
    # ========================================================================

    def _to_pdflow_compiled(self, compiled: CompiledWorkflow, trim: bool) -> str:
        """Generate pdflow-compiled format (native Prompd format)."""
        output = {
            "version": compiled.version,
            "compiled": True,
            "metadata": compiled.metadata,
            "parameters": compiled.parameters,
            "steps": [],
            "edges": compiled.edges,
            "variables": compiled.variables
        }

        if compiled.error_handling:
            output["errorHandling"] = compiled.error_handling
        if compiled.execution_config:
            output["execution"] = compiled.execution_config

        for step in compiled.steps:
            step_data = {
                "id": step.id,
                "type": step.node_type,
            }

            if step.node_type == "prompt":
                step_data["prompt"] = step.compiled_prompt
                step_data["source"] = step.original_source
                if step.provider:
                    step_data["provider"] = step.provider
                if step.model:
                    step_data["model"] = step.model
                if step.parameters:
                    step_data["parameters"] = step.parameters
                if step.output_mapping:
                    step_data["outputMapping"] = step.output_mapping

            # Include metadata (but optionally strip visual-only fields)
            if step.metadata:
                if trim:
                    # Only include execution-relevant metadata
                    relevant_keys = ["label", "conditions", "default", "loopType", "condition",
                                     "items", "itemVariable", "count", "maxIterations", "body",
                                     "onComplete", "branches", "waitFor", "mergeStrategy",
                                     "mode", "checkpointName", "transform", "method", "url",
                                     "headers", "body", "outputSchema"]
                    step_data["metadata"] = {
                        k: v for k, v in step.metadata.items()
                        if k in relevant_keys and v is not None
                    }
                else:
                    step_data["metadata"] = step.metadata

            output["steps"].append(step_data)

        return json.dumps(output, indent=2)

    def _to_trim(self, compiled: CompiledWorkflow) -> str:
        """Generate minimal JSON without visual metadata."""
        output = {
            "version": compiled.version,
            "compiled": True,
            "parameters": [p["name"] for p in compiled.parameters],
            "steps": []
        }

        for step in compiled.steps:
            step_data = {
                "id": step.id,
                "type": step.node_type
            }

            if step.node_type == "prompt":
                step_data["prompt"] = step.compiled_prompt
                if step.provider:
                    step_data["provider"] = step.provider
                if step.model:
                    step_data["model"] = step.model
            else:
                # For other node types, include minimal metadata
                relevant = {k: v for k, v in step.metadata.items()
                           if k != "position" and k != "label" and v is not None}
                if relevant:
                    step_data.update(relevant)

            output["steps"].append(step_data)

        # Simple connections list
        output["connections"] = [
            {"from": e["source"], "to": e["target"]}
            for e in compiled.edges
        ]

        return json.dumps(output, indent=2)

    def _to_langflow(self, compiled: CompiledWorkflow, trim: bool) -> str:
        """Generate LangFlow compatible JSON format."""
        # LangFlow uses a specific node/edge format
        langflow_output = {
            "description": compiled.metadata.get("description", ""),
            "name": compiled.metadata.get("name", "Prompd Workflow"),
            "id": compiled.metadata.get("id", ""),
            "data": {
                "nodes": [],
                "edges": []
            }
        }

        # Convert steps to LangFlow nodes
        for step in compiled.steps:
            node = {
                "id": step.id,
                "type": self._map_node_type_to_langflow(step.node_type),
                "data": {
                    "id": step.id,
                    "type": step.node_type,
                }
            }

            if step.node_type == "prompt":
                node["data"]["template"] = step.compiled_prompt
                if step.provider:
                    node["data"]["provider"] = step.provider
                if step.model:
                    node["data"]["model"] = step.model

            if not trim and step.metadata.get("position"):
                node["position"] = step.metadata["position"]
            else:
                # Auto-position
                idx = compiled.steps.index(step)
                node["position"] = {"x": 100 + (idx * 250), "y": 100}

            langflow_output["data"]["nodes"].append(node)

        # Convert edges
        for edge in compiled.edges:
            langflow_output["data"]["edges"].append({
                "id": edge["id"],
                "source": edge["source"],
                "target": edge["target"],
                "sourceHandle": edge.get("sourceHandle", "output"),
                "targetHandle": edge.get("targetHandle", "input")
            })

        return json.dumps(langflow_output, indent=2)

    def _map_node_type_to_langflow(self, node_type: str) -> str:
        """Map Prompd node types to LangFlow types."""
        mapping = {
            "prompt": "PromptNode",
            "condition": "ConditionalNode",
            "loop": "LoopNode",
            "parallel": "ParallelNode",
            "output": "OutputNode",
            "transformer": "TransformNode",
            "api": "HTTPRequestNode",
            "callback": "PassThroughNode"
        }
        return mapping.get(node_type, "GenericNode")

    def _to_n8n(self, compiled: CompiledWorkflow, trim: bool) -> str:
        """Generate n8n workflow format."""
        n8n_output = {
            "name": compiled.metadata.get("name", "Prompd Workflow"),
            "nodes": [],
            "connections": {}
        }

        # Convert steps to n8n nodes
        for idx, step in enumerate(compiled.steps):
            node = {
                "id": step.id,
                "name": step.metadata.get("label", step.id),
                "type": self._map_node_type_to_n8n(step.node_type),
                "typeVersion": 1,
                "position": [100 + (idx * 200), 100]
            }

            if step.node_type == "prompt":
                node["parameters"] = {
                    "prompt": step.compiled_prompt,
                    "model": step.model or "gpt-4o"
                }
            elif step.node_type == "api":
                node["parameters"] = {
                    "method": step.metadata.get("method", "GET"),
                    "url": step.metadata.get("url", "")
                }

            n8n_output["nodes"].append(node)

        # Build connections map
        for edge in compiled.edges:
            source = edge["source"]
            target = edge["target"]

            if source not in n8n_output["connections"]:
                n8n_output["connections"][source] = {"main": [[]]}

            n8n_output["connections"][source]["main"][0].append({
                "node": target,
                "type": "main",
                "index": 0
            })

        return json.dumps(n8n_output, indent=2)

    def _map_node_type_to_n8n(self, node_type: str) -> str:
        """Map Prompd node types to n8n types."""
        mapping = {
            "prompt": "n8n-nodes-base.openAi",
            "condition": "n8n-nodes-base.if",
            "loop": "n8n-nodes-base.loop",
            "parallel": "n8n-nodes-base.splitInBatches",
            "output": "n8n-nodes-base.set",
            "transformer": "n8n-nodes-base.code",
            "api": "n8n-nodes-base.httpRequest",
            "callback": "n8n-nodes-base.noOp"
        }
        return mapping.get(node_type, "n8n-nodes-base.noOp")


def compile_workflow(
    workflow_path: Path,
    output_format: str = "pdflow-compiled",
    preserve_runtime_vars: bool = True,
    trim: bool = False,
    verbose: bool = False
) -> Tuple[str, Dict[str, Any]]:
    """
    Convenience function to compile a workflow.

    Args:
        workflow_path: Path to .pdflow file
        output_format: Target format (pdflow-compiled, langflow, n8n, trim, plain)
        preserve_runtime_vars: Keep {{ }} variables for runtime substitution
        trim: Remove visual/editor metadata
        verbose: Print progress info

    Returns:
        Tuple of (compiled_json_string, metadata_dict)
    """
    compiler = WorkflowCompiler(verbose=verbose)
    return compiler.compile(
        workflow_path,
        output_format=output_format,
        preserve_runtime_vars=preserve_runtime_vars,
        trim=trim
    )
