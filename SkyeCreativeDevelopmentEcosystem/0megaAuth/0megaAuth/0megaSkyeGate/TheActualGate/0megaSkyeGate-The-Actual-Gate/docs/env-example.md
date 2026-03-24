# Environment / Secret Example

Set these as Worker secrets or Wrangler vars. Secrets should be loaded server-side only.

## Required core

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put KAIXU_ADMIN_TOKEN
```

## Optional lane-separated keys

```bash
wrangler secret put OPENAI_TEXT_KEY
wrangler secret put OPENAI_IMAGES_KEY
wrangler secret put OPENAI_VIDEOS_KEY
wrangler secret put OPENAI_AUDIO_KEY
wrangler secret put OPENAI_REALTIME_KEY
```

## Optional project / model overrides

```bash
wrangler secret put OPENAI_PROJECT_ID
wrangler secret put OPENAI_TEXT_MODEL
wrangler secret put OPENAI_DEEP_MODEL
wrangler secret put OPENAI_CODE_MODEL
wrangler secret put OPENAI_VISION_MODEL
wrangler secret put OPENAI_IMAGE_MODEL
wrangler secret put OPENAI_VIDEO_MODEL
wrangler secret put OPENAI_SPEECH_MODEL
wrangler secret put OPENAI_TRANSCRIBE_MODEL
wrangler secret put OPENAI_REALTIME_MODEL
```

## Public brand / gate vars

```ini
KAIXU_PUBLIC_BRAND="Skyes Over London"
KAIXU_GATE_NAME="Kaixu"
ENABLE_CHAT="true"
ENABLE_STREAM="true"
ENABLE_IMAGES="true"
ENABLE_VIDEOS="true"
ENABLE_AUDIO_SPEECH="true"
ENABLE_AUDIO_TRANSCRIPTIONS="true"
ENABLE_REALTIME="true"
```

## Behavior notes

- If a lane-specific key is present, that key wins for that lane.
- If a lane is enabled but no usable key exists, the lane returns `KAIXU_LANE_DISABLED`.
- Frontends should never read or store these values.
