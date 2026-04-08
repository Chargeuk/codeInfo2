# Goal

Run the findings-phase audit for untrusted input crossing into dangerous interpreters, path resolvers, or authority-sensitive boundaries.

<review_rules>

- Apply this file when changed code accepts, transforms, or forwards user-controlled, repository-controlled, network-controlled, environment-controlled, or persisted input into a boundary where shape and escaping matter.
- Inspect changed paths where untrusted input can reach:
  - shell or CLI command construction;
  - filesystem paths, globbing, archive extraction, or path-join logic;
  - URLs, fetch targets, webhook destinations, or other outbound network targets;
  - query builders, filters, search expressions, or template or regex construction;
  - authz, tenancy, ownership, allowlist, or capability-sensitive selectors.
- Raise a finding when untrusted input can cross one of those boundaries without validation, normalization, escaping, canonicalization, or explicit allowlisting appropriate to that boundary.
- Raise a finding when path handling can escape the intended root, follow a weaker alias instead of a canonical identifier, or let user-controlled input select a broader resource than the contract allows.
- Raise a finding when UI or client-side restrictions appear to be the main guard for an authority-sensitive action but the changed server, tool, worker, or persisted execution path does not enforce the same boundary.
- Do not assume the dangerous boundary is only shell execution. The same review applies to path traversal, query injection, SSRF-like target selection, regex or template misuse, and capability-boundary bypass.

</review_rules>
