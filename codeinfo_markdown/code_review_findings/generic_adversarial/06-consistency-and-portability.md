# Goal

Run the narrow consistency and portability scan for changed non-support implementation files and changed user-facing docs.

<review_rules>

- After the main correctness and adversarial review, run a narrow consistency and portability scan on changed non-support implementation files plus changed user-facing docs such as `README.md` or `docs/**`.
- In that scan, look for:
  - duplicated literals where a nearby named constant already defines the same contract value;
  - absolute local filesystem links in changed user-facing docs such as `README.md` or `docs/**`;
  - changed mocks or test helpers that accept cancellation inputs but do not model already-aborted or already-cancelled state.
- Only raise low-severity findings from that consistency and portability scan unless you can prove a real behavior defect, contract break, or validation gap.

</review_rules>
