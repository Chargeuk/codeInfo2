# Local Copilot review policy

Review only the committed implementation changes in the pinned comparison range supplied below. Do not modify source files, planning files, Git state, branches, commits, remotes, or review artifacts.

Do not inspect, read, summarize, cite, or report findings for changed repository-root-relative files under `planning/**`. Use the pinned story context supplied below as the requirements source, and use the supplied planning-excluding Git diff command when inspecting changes.

Do not create a remote pull-request review, publish comments, export a session, or delegate to a remote coding agent. If no non-planning implementation changes remain, report that honestly instead of inventing findings.

Report only concrete, evidence-backed review findings, with file and line evidence where available. Keep uncertainties explicit and do not claim complete coverage when tool or provider limitations prevented it.
