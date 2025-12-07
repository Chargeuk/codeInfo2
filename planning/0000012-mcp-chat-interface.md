# Story 0000012 – Server MCP for Chat Interface

## Description

Expose a new MCP server (running on its own port) that mirrors the existing chat interface capabilities. The MCP will allow external agents to discover available repositories and ask questions against them through the same backing search/chat pipeline the frontend uses, without affecting the existing MCP server. This story plans the scope and defaults before implementation tasks are created.

## Acceptance Criteria

- A dedicated MCP server process (separate port/endpoint from the current MCP) is available from the Node server.
- Tool: **ListRepositories** returns all ingestable/ingested repositories with identifiers and host/container paths suitable for citations.
- Tool: **QueryRepository** accepts a natural-language question plus repo identifier and returns an answer grounded in repo content (using existing vector search + chat pipeline) with citations where possible.
- Server picks sensible defaults for Codex/LM Studio provider selection, model, sandbox/approval/network/search flags, and limits (tokens/chunks) so MCP callers need minimal parameters.
- Existing MCP server and HTTP APIs continue to function unchanged; enabling the new MCP does not regress current chat or tooling flows.
- Security and resource limits (concurrency, rate limits, payload size) are defined for the new MCP endpoint.

## Out Of Scope

- Persisting MCP conversations beyond a single request/response.
- Adding new embedding/ingest capabilities; reuse current ingest data only.
- Frontend changes; this story is server-only wiring.
- Authentication/authorization for the new MCP (assume same open access as current internal tools).

## Decisions (so far)

- Provider support: this MCP is **Codex-only**. If Codex is unavailable, the MCP endpoint should expose no tools (or surface a clear disabled/availability error) rather than falling back to LM Studio.
- Default model/effort: **gpt-5.1-codex-max** with **high** reasoning effort.

## Questions

- What limits should apply (max tokens per answer, max chunks per query, max concurrent requests, timeout)?
- Repo access: no per-repo allow/deny lists are required for this MCP.
- How should the MCP advertise unavailability when Codex is missing (empty tool list vs explicit error response)?
- Streaming shape: QueryRepository should stream, but only include thinking information and the final answer (no token-by-token partials).
- Defaults: sandbox, approval, network, and web-search flags should mirror the web (UI) defaults, but be configurable via server environment variables for this MCP.

## Implementation Plan

(Tasks will be drafted once the open questions are answered and defaults are agreed.)

## Tasks

_To be added after requirements are finalised._
