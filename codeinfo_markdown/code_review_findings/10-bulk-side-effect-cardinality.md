# Goal

Run the findings-phase bulk side-effect cardinality audit for changed loops that call helpers with refresh, reload, rerender, reset, or similar side effects.

<review_rules>

- Apply this file when changed code adds or changes a loop that calls helpers with refreshes, fetches, rerenders, resets, or similar side effects.
- Inspect whether the helper performs side effects once per item or once per batch.
- Raise a finding when per-item helper side effects multiply network requests, rerenders, or model reloads in a bulk path without direct proof that one-per-item behavior is required.
- Raise a finding when one-per-batch behavior appears intended by the surrounding UX or semantics but the implementation still performs the side effects per item.
- Raise a finding when helper-level error swallowing makes batch-level success reporting misleading or prevents the batch path from distinguishing mixed success from full success.

</review_rules>
