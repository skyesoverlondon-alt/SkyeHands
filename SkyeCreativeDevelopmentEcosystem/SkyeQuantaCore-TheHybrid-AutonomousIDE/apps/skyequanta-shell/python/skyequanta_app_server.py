import contextlib
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from skyequanta_runtime_bootstrap import configure_runtime

configure_runtime()

from openhands.app_server.config import get_app_lifespan_service
from openhands.app_server.v1_router import router as v1_router


def combine_lifespans(*lifespans):
    @contextlib.asynccontextmanager
    async def combined_lifespan(app):
        async with contextlib.AsyncExitStack() as stack:
            for lifespan in lifespans:
                await stack.enter_async_context(lifespan(app))
            yield

    return combined_lifespan


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    yield


lifespans = [_lifespan]
app_lifespan_service = get_app_lifespan_service()
if app_lifespan_service:
    lifespans.append(app_lifespan_service.lifespan)


app = FastAPI(
    title='SkyeQuantaCore App Server',
    description='Skyes Over London V1 application server surface for kAIxU orchestration.',
    version='0.1.0',
    lifespan=combine_lifespans(*lifespans),
)


def _is_json_request(request: Request) -> bool:
    content_type = request.headers.get('content-type', '')
    return 'application/json' in content_type.lower()


def _gate_api_base() -> str:
    return str(os.getenv('SKYEQUANTA_GATE_API_BASE') or '').rstrip('/')


def _locked_ai_settings_violations(payload: dict) -> list[str]:
    violations: list[str] = []
    gate_base = _gate_api_base()

    if payload.get('llm_api_key') not in (None, ''):
        violations.append('llm_api_key')

    llm_base_url = payload.get('llm_base_url')
    if llm_base_url not in (None, '', gate_base):
        violations.append('llm_base_url')

    for field in ('openai_api_key', 'anthropic_api_key', 'gemini_api_key'):
        if payload.get(field) not in (None, ''):
            violations.append(field)

    return violations


def _replay_body(body: bytes):
    async def receive() -> dict:
        return {'type': 'http.request', 'body': body, 'more_body': False}

    return receive

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware('http')
async def enforce_gate_only_ai_runtime(request: Request, call_next):
    if request.method in {'POST', 'PUT', 'PATCH'} and _is_json_request(request):
        body = await request.body()
        if body:
            try:
                payload = json.loads(body.decode('utf-8'))
            except json.JSONDecodeError:
                payload = None

            if isinstance(payload, dict):
                violations = _locked_ai_settings_violations(payload)
                if violations:
                    return JSONResponse(
                        status_code=403,
                        content={
                            'error': 'gate_only_ai_enforced',
                            'detail': 'Direct upstream AI credentials and base URLs are disabled. Route AI through the gate.',
                            'fields': violations,
                        },
                    )

        request = Request(request.scope, _replay_body(body))

    return await call_next(request)

app.include_router(v1_router)


@app.get('/alive')
async def alive():
    return {'status': 'ok'}


@app.get('/health')
async def health():
    return 'OK'


@app.get('/ready')
async def ready():
    return 'OK'