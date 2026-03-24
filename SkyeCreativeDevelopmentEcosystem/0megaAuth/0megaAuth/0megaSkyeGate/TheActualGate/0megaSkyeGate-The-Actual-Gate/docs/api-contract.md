# Kaixu Sovereign Multimodal Gateway — Public API Contract

All public callers speak only to Kaixu routes. Public responses never expose upstream vendor names, raw model ids, endpoint names, request ids, or raw upstream errors.

## Public routes

### `GET /v1/health`
Returns gate health, brand, runtime, and per-lane enabled/key-configured booleans.

### `GET /v1/models`
Requires app bearer token.
Returns the caller's allowed Kaixu aliases only.

### `POST /v1/chat`
Direct-response lane for text and multimodal request/response flows.

Request body:
```json
{
  "engine": "kaixu/flash",
  "messages": [
    { "role": "user", "content": "Write a summary." }
  ],
  "temperature": 0.4,
  "max_output_tokens": 1200,
  "metadata": {
    "user_id": "user_123",
    "session_id": "sess_123"
  }
}
```

Response body:
```json
{
  "ok": true,
  "trace_id": "trace_xxx",
  "engine": "Kaixu Flash",
  "output": { "text": "..." },
  "usage": {
    "estimated_cost_usd": 0,
    "input_tokens": 123,
    "output_tokens": 456
  }
}
```

### `POST /v1/stream`
Direct SSE lane. Returns Kaixu events only.

Events:
- `meta`
- `delta`
- `done`
- `error`

### `POST /v1/images`
Image generation/edit lane.
Returns normalized Kaixu image job envelope.

Response shape:
```json
{
  "ok": true,
  "job_id": "job_xxx",
  "trace_id": "trace_xxx",
  "engine": "Kaixu Image",
  "status": "completed",
  "assets": [
    {
      "asset_id": "img_1",
      "kind": "image",
      "mime_type": "image/png",
      "data_url": "data:image/png;base64,..."
    }
  ],
  "usage": {
    "estimated_cost_usd": 0,
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```

### `GET /v1/images/:job_id`
Returns normalized image job status and public-safe assets.

### `POST /v1/videos`
Async-only video lane.
Returns `202 Accepted` with Kaixu job envelope.

Response shape:
```json
{
  "ok": true,
  "job_id": "job_xxx",
  "trace_id": "trace_xxx",
  "engine": "Kaixu Video",
  "status": "queued",
  "progress": 0,
  "assets": []
}
```

### `GET /v1/videos/:job_id`
Returns normalized video job status.
Supports `?download=1` after completion to proxy video content via Kaixu.

### `POST /v1/audio/speech`
Text-to-speech lane.
Returns Kaixu audio asset reference/data URL.

### `POST /v1/audio/transcriptions`
Speech-to-text lane.
Returns normalized Kaixu transcription text and optional segments.

### `POST /v1/realtime/session`
Creates a server-side realtime client-secret session.
The frontend receives only the Kaixu-approved session payload.

### `GET /v1/usage`
Returns recent Kaixu traces visible to the authenticated app.

### `GET /v1/jobs/:job_id`
Returns a normalized public-safe job record.

## Admin-only routes

All admin routes require `Authorization: Bearer <KAIXU_ADMIN_TOKEN>`.

- `GET /admin/traces/:trace_id`
- `GET /admin/jobs/:job_id`
- `GET /admin/upstream/:trace_id`
- `POST /admin/retry/:job_id`
- `POST /admin/cancel/:job_id`

## Public aliases

- `kaixu/flash`
- `kaixu/deep`
- `kaixu/code`
- `kaixu/vision`
- `kaixu/image`
- `kaixu/video`
- `kaixu/speech`
- `kaixu/transcribe`
- `kaixu/realtime`

## Error normalization

Public callers receive Kaixu-only error codes:

- `KAIXU_UNAUTHORIZED`
- `KAIXU_ENGINE_UNAVAILABLE`
- `KAIXU_LANE_DISABLED`
- `KAIXU_JOB_FAILED`
- `KAIXU_UPSTREAM_TIMEOUT`
- `KAIXU_RATE_LIMITED`
- `KAIXU_INVALID_INPUT`
- `KAIXU_ASSET_UNAVAILABLE`
