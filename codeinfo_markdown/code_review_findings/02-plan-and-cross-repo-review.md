# Goal

Run the high-level findings-pass review order before the dense adversarial and seam-specific checks begin.

<review_rules>

- For all changed files outside the allowed support-file set, review:
  - correctness against the story plan;
  - acceptance criteria coverage;
  - code quality;
  - maintainability;
  - performance;
  - security;
  - configuration/runtime correctness;
  - user-facing documentation portability;
  - documentation drift;
  - scope creep;
  - whether the code is more verbose or complex than needed and could be made more succinct without sacrificing quality.
- For multi-repository stories, you MUST also perform an explicit cross-repository integration pass after the per-repository review.
- That cross-repository pass must inspect:
  - shared APIs;
  - shared types;
  - shared message or storage contracts;
  - env/config names;
  - compatibility assumptions;
  - dependency direction;
  - migration sequencing;
  - any producer/consumer mismatch that would not be visible when looking at one repository alone.
- Perform the plan-based review against the planned work and the branch diff for every repository in scope.
- After the plan-based review, perform a second pass that is not limited by the acceptance criteria and look for generic engineering defects in the changed code even if the canonical plan did not mention them.
- This second pass applies to the non-support-file changes only.

</review_rules>
