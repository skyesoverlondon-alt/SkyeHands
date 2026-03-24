import logging
import os
import warnings


_ORIGINAL_SHOWWARNING = warnings.showwarning


def _suppress_deprecation_warnings(message, category, filename, lineno, file=None, line=None):
    if issubclass(category, DeprecationWarning):
        return

    return _ORIGINAL_SHOWWARNING(message, category, filename, lineno, file=file, line=line)


def _normalize_gate_url(raw: str | None) -> str:
    value = str(raw or '').strip().rstrip('/')
    if not value:
        return ''
    return value


def _configure_gate_locked_llm_runtime() -> None:
    gate_url = _normalize_gate_url(os.getenv('SKYEQUANTA_GATE_URL'))
    if not gate_url:
        return

    gate_api_base = gate_url if gate_url.endswith('/v1') else f'{gate_url}/v1'
    gate_token = str(
        os.getenv('SKYEQUANTA_GATE_TOKEN')
        or os.getenv('SKYEQUANTA_OSKEY')
        or ''
    ).strip()
    gate_model = str(os.getenv('SKYEQUANTA_GATE_MODEL') or 'kaixu/deep').strip() or 'kaixu/deep'

    os.environ['SKYEQUANTA_GATE_API_BASE'] = gate_api_base
    os.environ['LLM_BASE_URL'] = gate_api_base
    os.environ['LITE_LLM_API_URL'] = gate_api_base
    os.environ['OPENAI_BASE_URL'] = gate_api_base
    os.environ['LLM_MODEL'] = gate_model
    os.environ['OPENAI_MODEL'] = gate_model

    if gate_token:
        os.environ['LLM_API_KEY'] = gate_token
        os.environ['OPENAI_API_KEY'] = gate_token

    os.environ['ANTHROPIC_API_KEY'] = ''
    os.environ['GEMINI_API_KEY'] = ''


def configure_runtime() -> None:
    os.environ.setdefault('LOG_LEVEL', 'WARNING')
    os.environ.setdefault('OPENHANDS_SUPPRESS_BANNER', '1')
    os.environ.setdefault('PYTHONWARNINGS', 'ignore')

    warnings.showwarning = _suppress_deprecation_warnings
    warnings.simplefilter('ignore', DeprecationWarning)

    warnings.filterwarnings(
        'ignore',
        message='.*audioop.*',
        category=DeprecationWarning,
    )
    warnings.filterwarnings(
        'ignore',
        category=DeprecationWarning,
        module='speech_recognition',
    )
    warnings.filterwarnings(
        'ignore',
        message='There is no current event loop',
        category=DeprecationWarning,
    )

    logging.getLogger('alembic').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.orm').setLevel(logging.WARNING)

    _configure_gate_locked_llm_runtime()