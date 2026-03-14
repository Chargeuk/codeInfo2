# Future Ideas

- Rework Chat model-selection/runtime-config handling so switching to `gpt*` models does not inherit an incompatible `model_provider` from `codex/chat/config.toml`. The current Chat path appears to preserve `model_provider = "lmstudiospark"` even when the selected model is a Codex/OpenAI model, which can route requests through the wrong provider and cause provider errors.
