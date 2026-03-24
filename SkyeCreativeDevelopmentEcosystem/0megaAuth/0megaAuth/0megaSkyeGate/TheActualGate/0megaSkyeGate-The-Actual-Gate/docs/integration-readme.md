# Frontend Integration Map

Every app surface should call Kaixu routes only.

## Call map

- Standard prompt/response UI → `POST /v1/chat`
- SSE text UI → `POST /v1/stream`
- Image generation / edit UI → `POST /v1/images`
- Video generation UI → `POST /v1/videos`, then poll `GET /v1/videos/:job_id`
- Speech synthesis UI → `POST /v1/audio/speech`
- Audio upload transcription UI → `POST /v1/audio/transcriptions`
- Browser realtime client bootstrap → `POST /v1/realtime/session`
- Usage dashboard → `GET /v1/usage`
- Generic job polling panel → `GET /v1/jobs/:job_id`

## Frontend rules

- Never call OpenAI directly.
- Never assume `/v1/chat` or `/v1/stream` can impersonate image/video/audio lanes.
- Treat `trace_id` and `job_id` as the source of truth.
- Poll Kaixu job routes for async lanes.
- Queue artifact export / PDF / ZIP work separately from hot inference routes.

## Product shell integration

- The SkyeQuanta shell should proxy this gate as `/api/gate` and expose that path as the only browser-visible AI origin.
- For OpenAI-compatible clients that cannot call the native Kaixu routes directly, use `POST /v1/chat/completions` through the gate proxy.
- When integrating OpenHands or other OpenAI-compatible stacks, point the client base URL at the shell bridge route ending in `/api/gate/v1`.
- Use a `0sKey` as the bearer credential for product-owned application traffic.
- Keep upstream provider names and keys internal to the gate runtime only.
