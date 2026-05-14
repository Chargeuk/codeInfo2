# Goal

Run the routing-selection and early-failure findings pass for changed non-support implementation files.

<review_rules>

- In this pass, prioritize control-flow bugs where an earlier layer can reject, normalize, classify, or lock in a decision before a later layer that is supposed to be the authoritative owner of execution, fallback, retry, or recovery.
- For every changed route, validator, selector, availability helper, fallback helper, dispatcher, or execution-preparation helper outside the allowed support-file set, identify:
  - the first early return;
  - the first throw or failure result;
  - the first unavailable or disabled classification;
  - the first candidate-specific initialization such as config loading, client creation, bootstrap probing, or provider setup.
- Raise a finding when any of those earlier steps can prevent the later authoritative layer from applying its intended fallback, retry, degraded-mode, or execution-selection contract.
- Treat "fallback exists elsewhere" as insufficient by itself. The review must check whether fallback is still reachable when the first candidate fails in the realistic way introduced or preserved by the changed code.
- Treat "the request later calls a selector" as insufficient by itself. The review must check whether an earlier validator, guard, or availability helper can terminate the request before that selector runs.
- For multi-candidate execution paths, raise a finding when candidate-specific config loading, runtime resolution, client creation, bootstrap reading, or similar failure-prone work happens before the winning candidate is chosen, unless the plan explicitly requires that eager initialization and the proof directly covers the unhappy path.
- For paired modes such as explicit vs implicit, fresh vs resumed, replay vs first-run, or selected vs fallback, compare the modes directly and raise a finding when an earlier layer applies different authority rules to one mode without a clearly planned reason and direct proof.
- When a changed seam writes or preserves warnings, reasons, or unavailable-state diagnostics, trace whether those diagnostics still survive the selection boundary that actually decides the execution path. Raise a finding when the earlier layer can fail or return without giving the later owner a chance to surface the more accurate outcome.

</review_rules>

<workflow_steps>

1. Identify the authoritative owner for the changed seam, such as the route-level selector, fallback chooser, retry coordinator, resume coordinator, or final execution-preparation boundary.
2. Trace the changed path from input admission to that authoritative owner and list the earlier control-flow branches that can terminate or narrow the request before the owner runs.
3. For each earlier branch, ask whether it is allowed to decide the final outcome itself or whether it should merely preserve information for the later owner.
4. For each multi-candidate path, ask whether candidate-specific initialization happens before final selection and whether that ordering can block fallback or later selection.
5. Record at least one contradiction scenario per risky seam using the required checks below.

</workflow_steps>

<required_contradiction_checks>

- Could an implicit or defaulted request fail in validation or admission even though the later authoritative selector would have chosen a healthy fallback or alternate path?
- Could an explicit request and an implicit request reach different controlling layers, with one path failing earlier for a reason the other path would recover from?
- Could candidate A throw, mark itself unavailable, or return an invalid configuration before the code proves whether candidate B should run instead?
- Could a resumed, replayed, deferred, or retried path perform provider-specific or candidate-specific setup before proving that real work still remains?
- Could the changed code now depend on happy-path proof only, while the unhappy path that exercises routing, fallback, or selection authority remains unproven?

</required_contradiction_checks>

<examples>

- Example: a request validator resolves the default provider and throws immediately when that provider is degraded, even though the route later owns fallback selection for non-explicit requests.
- Example: an agent execution helper loads provider-specific runtime config for the initially requested provider before fallback order is evaluated, so a bad config file stops the run before another healthy provider can be chosen.
- Example: a replay fast path is supposed to return an already-completed result, but it still resolves external runtime dependencies before proving that no new work exists.

</examples>

<output_contract>

- When this pass finds a defect, the finding must name:
  - the earlier layer that made the premature decision;
  - the later authoritative layer that should have retained control;
  - the concrete contradiction scenario that demonstrates the bug class;
  - the file references that show the early branch and the later authority boundary.
- When this pass does not find a defect for a risky seam, the review artifact should still record that the contradiction was checked and why the later authoritative layer remains reachable under failure.

</output_contract>

<verification_loop>

- Confirm that each risky seam identified its later authoritative owner explicitly rather than assuming one exists.
- Confirm that at least one contradiction scenario was traced for each risky routing or fallback seam.
- Confirm that fallback, retry, or degraded-mode behavior was checked for reachability under failure, not only for existence in happy-path code.
- Confirm that explicit vs implicit, fresh vs resumed, or equivalent paired modes were compared directly when the changed code supports both.
- Confirm that candidate-specific initialization was reviewed for ordering relative to final selection.
- Confirm that the review did not stop at "the selector exists later" without checking whether an earlier branch can terminate before that selector runs.
- Repeat the key rule for long-context reliability: do not accept a later authoritative selector as proof of safety when an earlier layer can still kill the request before that selector gets a chance to run.

</verification_loop>
