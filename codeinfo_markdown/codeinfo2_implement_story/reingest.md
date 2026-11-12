# Retain indexed coverage or report ingestion unavailable

Read `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/shared.md` and apply it.

Use indexed repository coverage only when identity and covered content/scope are supported by available evidence. If authorized indexing is available and current coverage is insufficient, use the documented bounded ingestion procedure once and await its terminal result. Never invent a repository selector or infer coverage from HEAD alone. If the tool, selector, or network is unavailable or fails, report ingestion unavailable and continue safe work from fresh disk; this alone does not block the flow. Do not repeatedly probe unchanged conditions, mutate unrelated harness state, or run tests/builds here.
