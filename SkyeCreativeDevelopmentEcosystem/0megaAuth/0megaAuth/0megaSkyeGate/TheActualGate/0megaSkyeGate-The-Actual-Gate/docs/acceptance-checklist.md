# Acceptance Checklist

## Core routing

- [ ] `GET /v1/health` returns lane status without upstream vendor/model leakage.
- [ ] `GET /v1/models` returns Kaixu aliases only.
- [ ] `POST /v1/chat` returns Kaixu engine name, output, usage, and trace id.
- [ ] `POST /v1/stream` emits only `meta`, `delta`, `done`, and `error` events.

## Multimodal lanes

- [ ] `POST /v1/images` returns normalized image assets and trace/job ids.
- [ ] `GET /v1/images/:job_id` returns image job state and public-safe assets.
- [ ] `POST /v1/videos` returns `202 Accepted` with a Kaixu job envelope.
- [ ] `GET /v1/videos/:job_id` polls and normalizes async video status.
- [ ] `POST /v1/audio/speech` returns a Kaixu audio asset ref/data URL.
- [ ] `POST /v1/audio/transcriptions` returns normalized text/segments.
- [ ] `POST /v1/realtime/session` returns a Kaixu session payload with client secret only.

## Hardening rules

- [ ] Missing lane keys fail with `KAIXU_LANE_DISABLED`.
- [ ] Public responses never expose upstream provider names or raw model ids.
- [ ] Public responses never include raw upstream errors.
- [ ] Async video is never faked as token streaming.
- [ ] Frontend integration uses Kaixu routes only.

## Observability

- [ ] Every inference/media request writes a trace record.
- [ ] Async image/video requests write job records.
- [ ] Admin can inspect upstream vendor/model/job truth.
- [ ] Admin can retry/cancel video jobs.
