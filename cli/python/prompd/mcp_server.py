"""
Minimal MCP-style HTTP server for Prompd using FastAPI.

Endpoints (JSON):
  GET  /health                 -> { status, version }
  GET  /compile                -> compile a .prmd/.pdflow (query: to, params=json)
  POST /run                    -> { provider, model, params, meta, version }
  GET  /validate               -> validate the file

Auth (optional):
  If oauth config provided, expects Authorization: Bearer <token> and performs a minimal presence check.
  Real token validation should be implemented by users; this is a stub to wire flows.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
import uvicorn

from .compiler import PrompdCompiler
from .executor import PrompdExecutor
from .parser import PrompdParser
from .config import PrompdConfig
from .exceptions import PrompdError


def _require_auth(oauth: Optional[Dict[str, Any]]):
    async def dependency(req: Request):
        if oauth and oauth.get("client_id"):
            auth = req.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Missing bearer token")
        return True
    return dependency


def create_app(file_path: Path, oauth: Optional[Dict[str, Any]] = None) -> FastAPI:
    app = FastAPI(title="Prompd MCP Server", version="1.0.0")
    source = Path(file_path).resolve()
    if not source.exists():
        raise RuntimeError(f"File not found: {source}")

    auth_dep = _require_auth(oauth)

    @app.get("/health")
    async def health():
        return {"status": "ok", "file": str(source)}

    @app.get("/validate", dependencies=[Depends(auth_dep)])
    async def validate():
        try:
            if source.suffix == ".prmd":
                PrompdParser().parse_file(source)
            # For .pdflow you could add flow validation here
            return {"ok": True}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/compile", dependencies=[Depends(auth_dep)])
    async def compile_endpoint(to: str = "markdown", params: Optional[str] = None):
        try:
            parameters: Dict[str, Any] = {}
            if params:
                try:
                    parameters = json.loads(params)
                except Exception:
                    # also support key=value,key2=value2
                    for pair in params.split(','):
                        if '=' in pair:
                            k, v = pair.split('=', 1)
                            parameters[k.strip()] = v.strip()
            result = PrompdCompiler().compile(source, output_format=to, parameters=parameters)
            return JSONResponse(content={"result": result})
        except PrompdError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/run", dependencies=[Depends(auth_dep)])
    async def run_endpoint(body: Dict[str, Any]):
        try:
            cfg = PrompdConfig.load()
            provider = body.get("provider") or (cfg.default_provider or "openai")
            model = body.get("model") or (cfg.default_model or ("gpt-3.5-turbo" if provider=="openai" else "claude-3-haiku-20240307"))
            params = body.get("params") or {}
            meta = body.get("meta") or {}  # metaSystem/metaContext/metaUser
            version = body.get("version")

            # Execute
            import asyncio
            execu = PrompdExecutor()
            # Allow meta aliases via dict
            metadata_overrides = {}
            if "system" in meta:
                metadata_overrides["meta:system"] = meta["system"]
            if "user" in meta:
                metadata_overrides["meta:user"] = meta["user"]
            if "context" in meta:
                metadata_overrides["meta:context"] = meta["context"]

            # Convert params to CLI list format key=value
            cli_params = [f"{k}={v}" for k, v in params.items()]
            resp = asyncio.run(execu.execute(
                prompd_file=source,
                provider=provider,
                model=model,
                cli_params=cli_params,
                api_key=None,
                extra_config={},
                metadata_overrides=metadata_overrides or None
            ))
            return {"content": resp.content, "usage": resp.usage, "model": resp.model}
        except PrompdError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return app


def serve_app(file_path: Path, host: str = "0.0.0.0", port: int = 3333, oauth: Optional[Dict[str, Any]] = None):
    app = create_app(file_path, oauth)
    uvicorn.run(app, host=host, port=port)

