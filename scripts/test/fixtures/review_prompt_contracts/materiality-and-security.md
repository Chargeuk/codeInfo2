# Fixture: Materiality and security decisions

These are hypothetical policy fixtures, not retrospective production findings or
evidence that an incident occurred. Expected decisions exercise the existing
review prompts; they are not a new runtime gate, schema, or evaluation framework.

## Bounded read-only exercise

Read only this fixture, `codeinfo_markdown/shared/story_behavior_lock.md`, and
`codeinfo_markdown/filter_review_batch_findings_by_materiality.md`. For each case,
give a concise semantic decision and reason using its supplied scope and evidence.
Challenge actual operations, application-produced inputs, invariants, upstream
checks, or attacker access and permissions before judging harm and lasting
complexity. Do not inspect a production story, run commands, create artifacts,
edit files or handoffs, create tasks, or continue repair. Missing evidence stays
non-actionable. The expected outcomes below are fixture expectations, not proof
that a model or production flow made these decisions.

## Fixture story assumptions

The hypothetical hair story supports default primary UVs, non-overlapping painted
regions, browser-decoded PNG inputs, and selection of a usable embedded scalp
before consulting an external scalp. Its approved contract requires successful
combined hair generation within an existing combined budget and preserves the
documented accepted guide-root placement range. Broad "validate" wording adds no
caps or rejection rules. The six hair exclusions below are explicitly OUT OF
SCOPE in this fixture's current approved contract, even if older accepted/tested
commits handled them.

Security cases concern reviewed story-owned server operations whose approved
contract requires authorization and enforcement of an existing resource bound.
Explicit scope exclusions still bind. Crafted requests are allowed as attack
evidence; unrelated or pre-existing vulnerabilities remain outside this story.
No numeric likelihood threshold or observed production incident is required.

## Overlapping head/body painted UVs

- Scope/evidence: explicitly OUT OF SCOPE; supported exports have non-overlapping
  head/body painted UVs. A hand-edited overlapping map creates ambiguous sampling.
- Proposed remedy: add a permanent overlap scan and reject previously accepted data.
- Expected outcome: rejected. The unsupported map and excluded compatibility work
  establish neither an authorized supported failure nor concrete security harm.

## UV2

- Scope/evidence: explicitly OUT OF SCOPE; the application produces primary UVs.
  A synthetic asset stores the desired map only in UV2.
- Proposed remedy: add secondary-UV discovery, selection, and fallback behavior.
- Expected outcome: rejected. A synthetic unsupported asset does not override the
  documented assumption or authorize new selection behavior.

## Nondefault UV transforms

- Scope/evidence: explicitly OUT OF SCOPE; supported exports use default UV
  transforms. A manually transformed texture yields a different sampled region.
- Proposed remedy: add transform interpretation and runtime branches.
- Expected outcome: rejected. This broadens excluded input compatibility.

## 0.015 guide-root scalp distance

- Scope/evidence: explicitly OUT OF SCOPE; a guide root at scalp distance 0.015
  is valid under the documented accepted placement range. No supported generation
  failure or concrete harm is demonstrated at that distance.
- Proposed remedy: introduce a stricter distance cutoff and reject the guide.
- Expected outcome: rejected. Broad "validate" does not authorize an invented cap
  or new rejection behavior for a supported input.

## Full server PNG decode solely for validity after browser decode

- Scope/evidence: explicitly OUT OF SCOPE; the browser has already decoded the
  selected PNG successfully and the application submits that validated input.
  The reviewer demonstrates only that a crafted broken unused payload is accepted,
  with no vulnerable operation or resource-exhaustion evidence.
- Proposed remedy: fully decode every PNG again on the server solely for validity.
- Expected outcome: rejected. Duplicated validation, scans, and allocations add
  lasting complexity without a reachable supported failure or security harm.

## Unusable unused external scalp after usable embedded scalp selection

- Scope/evidence: explicitly OUT OF SCOPE; a usable embedded scalp is already
  selected. Current selection invariants keep an unusable external scalp unused.
- Proposed remedy: validate the unused external scalp and reject the whole input.
- Expected outcome: rejected. There is no supported downstream failure, and this
  changes the approved selection/fallback contract.

## Genuine combined-hair-budget failure

- Scope/evidence: positively authorized; an ordinary user combines two supported
  hair groups produced by the application. Each passes upstream individual checks,
  but their sum exceeds the existing approved combined budget. The current
  story-owned aggregate omits the total and fails generation after partial work.
- Proposed remedy: enforce the already approved combined budget at the existing
  aggregation seam, without inventing a cap or a new compatibility policy.
- Expected outcome: accepted. A concrete supported operation meaningfully fails;
  a minimal total check restores the exact contract with proportional complexity.

## Extremely rare low-impact issue with permanent machinery

- Scope/evidence: positively authorized; a supported recovery sequence can very
  rarely repeat an informational status line. It loses no work, changes no result,
  and requires no operator intervention. Supplied investigation shows that an
  effective correction requires a permanent registry, full scans, extra allocations,
  duplicated validation, configuration, branches, and ongoing maintenance.
- Proposed remedy: introduce that machinery to eliminate the harmless duplicate.
- Expected outcome: rejected. Qualitative likelihood and negligible impact do not
  justify substantial lasting complexity. This is not mere repair difficulty.

## Synthetic normal valid input failure

- Scope/evidence: positively authorized; a synthetic fixture reproduces an ordinary
  application-produced valid input and actual user operation. It preserves all
  invariants, passes upstream checks, and deterministically loses a requested group
  at the story-owned aggregation seam. No production incident has been observed.
- Proposed remedy: correct the existing accumulator, with no new policy machinery.
- Expected outcome: accepted. The test supplies ordinary supported inputs and a
  concrete meaningful failure; no observed production incident is required.

## Credible malicious request auth bypass

- Scope/evidence: positively authorized; an authenticated low-privilege attacker
  can reach the reviewed story-owned edit endpoint. A crafted resource identifier
  bypasses the new handler's ownership check and changes another user's record.
  Upstream authentication establishes identity but does not enforce ownership;
  the approved edit contract requires ownership. The UI never sends this request.
- Proposed remedy: use the existing ownership guard before the edit; evidence
  shows it blocks unauthorized changes while preserving authorized edits.
- Expected outcome: accepted. Attacker permissions, vulnerable operation, concrete
  unauthorized harm, and an effective proportional minimal repair are established.

## Credible malicious request resource attack

- Scope/evidence: positively authorized; a remotely reachable story-owned endpoint
  expands attacker-controlled input before applying its existing approved resource
  bound. A crafted small request exhausts worker memory, disrupting other users;
  upstream checks constrain request bytes but do not constrain the expansion.
- Proposed remedy: move the existing approved bound check before allocation;
  supplied evidence shows bounded work and preserved ordinary results.
- Expected outcome: accepted. Resource exhaustion is concrete, access is reachable,
  and the effective minimal repair adds no invented cap or decoder framework.

## Malformed unused data alone

- Scope/evidence: the reviewed story-owned handler accepts malformed optional data
  that remains unused. The reviewer labels it "security" but shows no unauthorized
  read/change, code execution, resource cost, or other concrete harm.
- Proposed remedy: add a parser, duplicated validation, and rejection branch.
- Expected outcome: rejected. Merely accepts malformed data is not security
  evidence; the label cannot authorize speculative hardening or reject behavior.

## Rare credible data loss

- Scope/evidence: positively authorized; an extremely rare supported reconnect
  interleaving can overwrite saved user work through a story-owned stale-write
  branch. Explicit gates establish reachable ordering and upstream checks do not
  prevent it. The approved contract preserves saved work.
- Proposed remedy: preserve the existing revision guard on this branch. Diagnosis
  is difficult, but the final guard is small and prevents the evidenced loss.
- Expected outcome: accepted. Rare credible data loss is material; difficult
  investigation does not excuse a necessary proportional repair.

## Uncertain reachability

- Scope/evidence: positively authorized observation at a story-owned seam, but a
  synthetic corrupted internal object is the only failure. It is unknown whether
  any application producer can create it or whether upstream checks reject it.
- Proposed remedy: add permanent recovery branches in case it is reachable.
- Expected outcome: non-actionable. Preserve the evidence and uncertainty; create
  no task, repair continuation, or review-loop blocker. Uncertainty is not proof
  that no defect exists and does not authorize speculative machinery.

## Attacker permissions and scope challenge

- Scope/evidence: a "security" report's crafted request succeeds only with an
  administrator's explicit bulk-delete permission. The operation performs exactly
  the authorized delete; no lower-privilege access path or bypass is demonstrated.
  That server operation also predates this story and is outside its reviewed seam.
- Proposed remedy: restrict administrators and add a new confirmation policy.
- Expected outcome: rejected. Challenge both attacker permissions and story-local
  scope; an authorized action and unrelated pre-existing surface get no blanket
  security pass.

## Reachable pre-existing auth bypass outside story scope

- Scope/evidence: a genuine low-privilege auth bypass exists on an unrelated,
  pre-existing server endpoint. This story neither changes nor authorizes its repair.
- Proposed remedy: apply a proven ownership guard to that endpoint.
- Expected outcome: rejected for this story. Concrete security harm does not cure
  missing authority. Preserve evidence for separately approved follow-up only.

## Upstream rejection prevents supported failure

- Scope/evidence: the reviewer bypasses the application producer and directly calls
  an internal aggregation helper with an invalid group. Repository evidence shows
  every supported entry point rejects that group before the helper; no alternate
  reachable server attack or concrete security harm is demonstrated.
- Proposed remedy: duplicate the upstream check in the internal helper.
- Expected outcome: rejected. A synthetic helper failure proves behavior without
  establishing a supported production path or proportional security repair.
