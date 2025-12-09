# Story 0000014 – Unified Chat Interface Abstraction

## Description

Unify the server-side chat execution paths so LM Studio and Codex share the same abstractions and so LM Studio can be exposed through the MCP v2 interface. Introduce a `ChatInterface` base abstraction that centralises shared concerns (conversation persistence, streaming adapters, flags handling), then implement provider-specific subclasses (e.g., `ChatInterfaceLMStudio`, `ChatInterfaceCodex`) chosen via a factory for both REST and MCP callers. The end result keeps current behaviour for existing providers while enabling LM Studio via MCP without duplicating logic or scattering provider-specific conditionals.

### MCP response handling (answered)

MCP v2 response format stays unchanged (single JSON-RPC result with ordered `segments`). We will wrap the streaming `ChatInterface` output in an MCP-specific responder/adapter that buffers the event stream (tokens, tool events, finals) into the existing MCP payload shape, then returns once complete. The wrapper is transport-specific, while the provider-specific derived classes (`ChatInterfaceLMStudio`, `ChatInterfaceCodex`) remain streaming-first; any new provider gains MCP support automatically via this wrapper without MCP-specific code in the provider class.

## Acceptance Criteria

- A common `ChatInterface` abstraction exists that covers shared workflow: loading conversation history by id, appending turns/status/tool calls, and emitting responses to REST streams and MCP callers.
- Provider-specific classes (at least LM Studio and Codex) use the common base while encapsulating only provider-specific API calls and quirks.
- REST `/chat` and MCP v2 `codebase_question` use the factory to obtain the correct provider implementation; conditional logic in route/handler files is minimised.
- LM Studio is available through the MCP v2 path with conversation-id-based history (no full-history payloads) and parity with REST behaviour (tools, citations, status).
- Behavioural parity: existing REST/Codex flows remain unchanged from a user perspective; regression tests stay green.
- Documentation updated to describe the new abstraction/factory, including how REST and MCP select providers and how to add future providers.

## Out Of Scope

- Adding new providers beyond LM Studio/Codex (e.g., Ollama, Claude).
- Changing client UI beyond any small wiring needed for MCP LM Studio support.
- Altering persistence schema or introducing new persistence backends.
- Refactoring tooling endpoints outside the chat execution path.

## Questions

- [Answered] Should MCP v2 responses share the same streaming adapter as REST, or keep MCP as single-response while reusing shared turn/metadata handling? → Keep MCP single-response format; use an MCP responder wrapper around the streaming `ChatInterface` to aggregate events into the current segment payload, so new providers work automatically with MCP.
- [Answered] Where should streaming adapters live: inside `ChatInterface` or as pluggable responders injected by the factory? → Keep it simple initially: place streaming/response adapter logic in the base `ChatInterface` (overridable by subclasses if required). If additional transports emerge later, refactor into pluggable responders at that point.
- [Answered] Do we want per-provider configuration (timeouts, model maps) centralised in the factory or alongside each subclass? → Keep provider-specific configuration inside each provider subclass; the factory simply selects the subclass so adding a new provider doesn’t require edits in multiple places.
- [Answered] How should provider capability discovery be exposed to the factory (static list vs. runtime health checks)? → Use a simple static list for now to keep complexity low; revisit runtime health checks if/when needed.
- Any constraints on backwards compatibility of MCP payload shape when LM Studio is added (e.g., must segments mirror Codex output format)?

## Implementation Plan

Copy the standard Implementation Plan instructions from `planning/plan_format.md` when creating tasks for this story. Do not start tasks until scope and questions above are clarified.

## Tasks

Tasks will be added once scope questions are resolved.
