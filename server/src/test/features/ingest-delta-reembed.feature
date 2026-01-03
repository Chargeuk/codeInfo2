Feature: Ingest delta re-embed

  Delta re-embed uses the per-file hash index (ingest_files) to only re-embed changed/new files
  and to delete vectors for deleted files, avoiding expensive full rebuilds.

  Background:
    Given the ingest delta test server is running with chroma and lmstudio
    And ingest delta chroma stores are empty
    And ingest delta models scenario "basic"

  @mongo
  Scenario: Changed file replacement updates vectors and ingest_files
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    When I change ingest delta temp file "a.ts" to "export const a=2;"
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "completed"
    And ingest delta vectors for "a.ts" should not contain the previous hash
    And ingest delta vectors for "a.ts" should contain the current hash
    And ingest delta ingest_files row for "a.ts" should equal the current hash

  @mongo
  Scenario: Deleted file cleanup removes vectors and ingest_files row
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    When I delete ingest delta temp file "a.ts"
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "skipped"
    And ingest delta vectors for "a.ts" should be absent
    And ingest delta ingest_files row for "a.ts" should be absent

  @mongo
  Scenario: Added file ingest inserts vectors and ingest_files row
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    When I add ingest delta temp file "b.ts" containing "export const b=1;"
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "completed"
    And ingest delta vectors for "b.ts" should contain the current hash
    And ingest delta ingest_files row for "b.ts" should equal the current hash

  @mongo
  Scenario: Unchanged file untouched keeps vectors and ingest_files stable
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    And ingest delta temp repo with file "b.ts" containing "export const b=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    When I change ingest delta temp file "b.ts" to "export const b=2;"
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "completed"
    And ingest delta vectors for "a.ts" should contain its original hash
    And ingest delta ingest_files row for "a.ts" should equal its original hash

  @mongo
  Scenario: Corner case all files deleted still cleans up and completes
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    When I delete ingest delta temp file "a.ts"
    And ingest delta discovery for the delta repo should find 0 eligible files
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "skipped"
    And ingest delta vectors for "a.ts" should be absent
    And ingest delta ingest_files row for "a.ts" should be absent

  @mongo
  Scenario: Corner case no-op re-embed returns skipped with a clear message
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    And I remember ingest delta vector count for the delta repo
    When I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "skipped"
    And ingest delta last status message should mention no changes
    And ingest delta vector count for the delta repo should be unchanged

  @mongo
  Scenario: Corner case deletions-only re-embed message must not claim No changes detected
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    And ingest delta temp repo with file "b.ts" containing "export const b=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    When I delete ingest delta temp file "b.ts"
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "skipped"
    And ingest delta last status message should not be "No changes detected"
    And ingest delta vectors for "b.ts" should be absent

  Scenario: No-Mongo corner case re-embed works when Mongo is disconnected
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    And ingest delta mongo should be disconnected
    When I change ingest delta temp file "a.ts" to "export const a=2;"
    And I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "completed"

  @mongo
  Scenario: Legacy root upgrade removes old vectors and repopulates ingest_files
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    When I POST ingest start for the delta repo with model "embed-1"
    Then ingest delta status for the last run becomes "completed"
    And I remember the ingest delta runId
    And I delete all ingest_files rows for the delta repo root
    When I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "completed"
    And ingest delta vectors should not contain any vectors from the remembered runId
    And ingest delta ingest_files should be populated for all discovered files

  Scenario: Re-embed uses latest root metadata when duplicates exist
    Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
    And ingest delta roots collection contains duplicate metadata for the delta repo root:
      | lastIngestAt         | name     |
      | 2026-01-01T00:00:00Z | old-name |
      | 2026-01-02T00:00:00Z | new-name |
    When I POST ingest reembed for the delta repo
    Then ingest delta status for the last run becomes "completed"
    And ingest roots for the delta repo should have name "new-name"

