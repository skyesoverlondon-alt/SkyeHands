# Routing rules

Apps should request **Kaixu aliases**, not raw provider model names.

## Suggested aliases

- `kaixu/flash`
- `kaixu/deep`
- `kaixu/code`
- `kaixu/vision`
- `kaixu/embed`

## Strategy

- `kaixu/flash`: low-cost, low-latency lane
- `kaixu/deep`: higher-quality reasoning lane
- `kaixu/code`: coding-oriented lane
- `kaixu/vision`: multimodal lane
- `kaixu/embed`: embeddings lane

## Fallback behavior

If the primary route fails and fallbacks are enabled:

1. try next highest-priority internal route
2. record fallback log
3. only finalize burn for the successful upstream call

## Deterministic first

Do not start with mystical “AI decides the model” behavior.

Start with:

- rule-based alias selection
- explicit priority ordering
- explicit fallbacks
- explicit per-app allowlists
