Feature: Ingest re-embed

Scenario: re-embed updates root with new run
Given ingest manage chroma stub is empty
And ingest manage models scenario "basic"
And ingest manage temp repo with file "a.ts" containing "export const a=1;"
When I POST ingest manage start with model "embed-1"
Then ingest manage status for the last run becomes "completed"
When I GET ingest manage roots
Then ingest manage roots first model is "embed-1"
When I change ingest manage temp file "a.ts" to "export const a=2;"
And I POST ingest manage reembed for the temp repo
Then ingest manage status for the last run becomes "completed"
When I GET ingest manage roots
Then ingest manage roots first model is "embed-1"

@mongo
Scenario: re-embed uses lock-derived provider and accepts the queued request
Given ingest manage chroma stub is empty
And ingest manage root metadata exists for "/tmp/reembed-root" with legacy model "embed-1"
And ingest manage lock is provider "openai" model "text-embedding-3-small" dimensions 1536
When I POST ingest manage reembed for root "/tmp/reembed-root"
Then ingest manage response status is 202
And ingest manage status for the last run becomes "completed"

@mongo
Scenario: startup recovery resumes running work before newer waiting work
Given ingest manage chroma stub is empty
And ingest manage mongo queue is empty
And ingest manage mongo queue has running request for "/tmp/recover-first" with run id "run-recovered"
And ingest manage mongo queue has waiting request for "/tmp/recover-second"
And ingest manage queue runtime records started paths
When ingest manage startup recovery runs
Then ingest manage queue runtime started paths are "/tmp/recover-first"
And ingest manage logs include "QUEUE_STARTUP_RECOVERY_RESUMED_IN_ORDER"
