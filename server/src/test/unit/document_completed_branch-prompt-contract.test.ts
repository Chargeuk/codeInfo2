import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(process.cwd(), '..');
const prompt = (name: string) =>
  fs.readFileSync(
    path.join(repoRoot, 'codeinfo_markdown', 'retrospective_story', name),
    'utf8',
  );

// Instruction-contract proofs, not execution of an autonomous LLM. Each match
// guards a distinct rule, command, or metadata field rather than a paragraph.
const requires = (name: string, contracts: Array<[string, RegExp]>) => {
  const text = prompt(name);
  for (const [contract, pattern] of contracts) {
    assert.match(text, pattern, `${name}: ${contract}`);
  }
};

test('retrospective content, tasking, and audit independently carry forward explicit original requirements', () => {
  for (const name of [
    '02-description.md',
    '03-acceptance.md',
    '04-out-of-scope.md',
    'tasking/01-inventory.md',
    'tasking/02-completed-tasks.md',
    'tasking/03-final-validation.md',
    'tasking/04-check.md',
    'tasking/05-repair.md',
    '10-audit.md',
  ]) {
    requires(name, [
      ['independent shared contract', /retrospective_story\/shared\.md/u],
      [
        'archive classifications invoked',
        /Apply the archive-accounting categories in shared\.md/u,
      ],
      [
        'explicit requirements survive missing implementation',
        /preserve every verified original explicit requirement, even when unimplemented/u,
      ],
      [
        'requirements distinguished from speculation',
        /distinguish it from speculative suggestions/u,
      ],
      [
        'unsupported completion and new repair work prohibited',
        /never claim unsupported implementation or test passes, create repair work/u,
      ],
      [
        'every receipt entry processed',
        /Process all `retrospective_archive\.entries` independently/u,
      ],
    ]);
  }
  requires('shared.md', [
    [
      'item detail rather than headings alone',
      /every source section and material item/u,
    ],
    [
      'compact destination accounting',
      /source-section\/item → destination-section map/u,
    ],
    ['material information retained', /without losing material information/u],
    ['remaining work retained', /completed work and remaining required work/u],
    [
      'questions facts and status preserved',
      /Questions content \(facts, unresolved questions, and answers\/status\)/u,
    ],
    [
      'four honest classifications',
      /implemented only when[^.]+still-required explicit requirement[^.]+superseded[^.]+future\/excluded proposal/u,
    ],
    [
      'incomplete requirements cannot be discarded',
      /Do not drop an incomplete explicit requirement because implementation lacks it/u,
    ],
    [
      'original exclusions stay excluded',
      /Original exclusions remain exclusions/u,
    ],
    [
      'no invented results',
      /never invent passes, authorization, outcomes, or rationale/u,
    ],
  ]);
});

test('retrospective review base is fresh remote develop even on reused branches while original HEAD remains provenance', () => {
  requires('01-create-layout.md', [
    [
      'source branch and original SHA retained',
      /original source branch and starting SHA[^.]+initial_head_commit/u,
    ],
    [
      'fresh remote base',
      /Fetch `origin` and resolve freshly fetched `origin\/develop` explicitly/u,
    ],
    [
      'base SHA or honest null',
      /`comparison_base_commit`[^.]+verified SHA, or null[^.]+fetch\/ref uncertainty/u,
    ],
    [
      'no false local substitute',
      /Never use a local fallback or claim remote success/u,
    ],
    [
      'develop marker applies to branch reuse',
      /`branched_from` to literal `develop` for both branch reuse and creation/u,
    ],
    [
      'replacement retains current implementation',
      /create `<namespace><number>-<short-description>` from current checked-out HEAD/u,
    ],
  ]);
  for (const name of ['10-audit.md', '11-commit-and-push.md']) {
    requires(name, [
      ['refresh once at closeout', /Fetch origin once/u],
      ['latest remote develop', /latest `origin\/develop`/u],
      [
        'original HEAD survives refresh',
        /preserving original (?:`initial_head_commit`|initial HEAD)/u,
      ],
    ]);
  }
});

test('retrospective story delta uses the retained initial HEAD merge-base and reports conditional resolver limitations without running review', () => {
  requires('shared.md', [
    [
      'exact merge-base inputs',
      /git merge-base <verified-origin-develop-sha> <initial-head>/u,
    ],
    [
      'delta ends at original implementation snapshot',
      /git diff <merge-base> <initial-head>/u,
    ],
    [
      'divergent develop tip is not the story delta',
      /Never use `git diff <develop-tip> <initial-head>`/u,
    ],
    [
      'unavailable delta remains honest',
      /If merge-base is unavailable[^.]+null\/unavailable delta range/u,
    ],
    [
      'default develop selection',
      /fresh `origin\/HEAD` is `develop`[^;]+selects `origin\/develop`/u,
    ],
    [
      'nondefault parent rule',
      /nondefault `develop`[^.]+unmerged parent and HEAD descends from it/u,
    ],
    [
      'default fallback accounted for',
      /otherwise the resolver falls back to its selected default branch/u,
    ],
    [
      'only actual inability is a limitation',
      /Report an actual limitation only when those rules cannot select develop/u,
    ],
    [
      'review engine remains untouched',
      /Do not modify or invoke the review engine/u,
    ],
  ]);
  requires('01-create-layout.md', [
    [
      'layout uses merge-base evidence',
      /git diff --name-status <merge-base> <initial-head>/u,
    ],
    [
      'layout excludes two-dot attribution',
      /never two-dot diff the develop tip against HEAD/u,
    ],
  ]);
  requires('10-audit.md', [
    ['audit uses merge-base', /merge-base-to-HEAD, not develop-tip-to-HEAD/u],
    [
      'audit checks actual selection',
      /report only an actual inability to select develop/u,
    ],
  ]);
});

test('retrospective identity changes preserve the receipt and clear only verified obsolete task state without selecting the open final task', () => {
  requires('01-create-layout.md', [
    [
      'complete receipt plus per-file limitations',
      /complete `entries` list and per-file limitations into `retrospective_archive`/u,
    ],
    [
      'canonical numbered active plan',
      /active `plan_path` must be the new canonical numbered plan, never the archived one-shot filename/u,
    ],
    [
      'only superseded task state invalidated',
      /invalidate it only if verified to belong to that superseded selection/u,
    ],
  ]);
  requires('shared.md', [
    [
      'all fields survive rewrite',
      /Preserve retrospective fields, archive receipts, and additional-repository evidence in every handoff rewrite/u,
    ],
    [
      'selector forbidden during documentation',
      /Never invoke `select_current_task\.py` or promote a task in this documentation-only flow/u,
    ],
    [
      'only owned superseded task state invalidated',
      /invalidate only a `current-task\.json` verified to belong to the superseded selection/u,
    ],
    [
      'preserve owned task bytes before clearing',
      /preserve its bytes safely[^;]+established archive location permit, then clear the obsolete live reference/u,
    ],
    [
      'uncertain task identity untouched',
      /If identity\/ownership is uncertain, leave it untouched/u,
    ],
    [
      'no manually constructed selector payload',
      /Do not create a replacement handoff or synthesize selector payloads/u,
    ],
    [
      'absent state expected',
      /missing current-task handoff is expected[^;]+not selected\/documentation only/u,
    ],
    [
      'checker cannot turn absent state into failure',
      /missing\/non-resolved status is not a flow failure/u,
    ],
    [
      'unverified state is not valid',
      /existing unverified handoff is not claimed valid\/resolved/u,
    ],
    [
      'selection deferred to later implementation',
      /later normal implementation flow may select a task with the unchanged helper/u,
    ],
    [
      'final task remains TODO with open checks',
      /preserve the final task as `__to_do__` with all checks open/u,
    ],
    [
      'receipt cannot be rewritten',
      /Never remove or rewrite the retrospective archive receipt/u,
    ],
  ]);
  requires('01-create-layout.md', [
    [
      'layout does not select tasks',
      /Do not invoke the current-task selector/u,
    ],
    [
      'checker is diagnostic only',
      /checker[^;]+optional read-only diagnostic, never as a gate/u,
    ],
    ['no valid task claim', /no valid\/resolved task is claimed/u],
  ]);
  requires('01-publish-branch.md', [
    [
      'early publication does not select tasks',
      /Do not invoke `select_current_task\.py` or create\/promote task state/u,
    ],
    [
      'only superseded state invalidated',
      /invalidates only state verified to match a superseded selection/u,
    ],
    [
      'absent task state expected',
      /Report an absent handoff as `not selected\/documentation only`/u,
    ],
    ['no valid task claim', /never claim a valid\/resolved task/u],
    [
      'selection belongs to later flow',
      /later normal implementation flow performs selection/u,
    ],
    [
      'preserve metadata and receipt',
      /Preserve all retrospective fields and receipts/u,
    ],
  ]);
  requires('11-commit-and-push.md', [
    [
      'only verified obsolete task state invalidated',
      /invalidate only a verified obsolete current-task reference/u,
    ],
    [
      'final correction does not select tasks',
      /do not invoke the selector or promote any task/u,
    ],
    [
      'final task preserved',
      /Preserve the final task as `__to_do__` with every checkbox unchecked/u,
    ],
    [
      'no successful selection invented',
      /report current-task as absent\/not selected or an unverified preserved handoff/u,
    ],
  ]);
});

test('retrospective superseded review controls require verified ownership and byte preservation without starting a review', () => {
  const shared = prompt('shared.md');
  for (const name of [
    'active-review-cycle.json',
    'review-disposition-state.json',
    'minor-review-fix-result.json',
    'review-initialization-failure.json',
  ]) {
    assert.ok(shared.includes(name), `live control: ${name}`);
  }
  requires('shared.md', [
    [
      'initialization is forbidden',
      /Do not call `initializeReviewCycle`; it starts a review/u,
    ],
    [
      'ownership required before archival',
      /Only when a control is verified as superseded by the prior selection/u,
    ],
    [
      'byte-preserving cycle archive',
      /archived byte-for-byte[^.]+review-cycles\/<verified-cycle-id>\//u,
    ],
    ['non-overwriting archival', /non-overwriting destination/u],
    [
      'existing archive compared before clearing',
      /destination exists, verify identical bytes/u,
    ],
    [
      'clear only preserved live state',
      /Clear its live path only after preservation is verified/u,
    ],
    [
      'reused plan identity uses original context',
      /If the plan path is reused, compare control identity with original branch\/HEAD context/u,
    ],
    [
      'uncertain ownership remains untouched',
      /If ownership or cycle identity is uncertain, leave state untouched/u,
    ],
    [
      'immutable history untouched',
      /Never overwrite different history[^.]+alter immutable historical cycle artifacts/u,
    ],
  ]);
  requires('01-create-layout.md', [
    ['layout does not initialize review', /Do not initialize a review cycle/u],
    [
      'layout checks superseded ownership',
      /Archive only verified superseded controls/u,
    ],
    [
      'layout clears only preserved bytes',
      /clear live state only after byte-preservation succeeds/u,
    ],
  ]);
});

test('early and final retrospective publication bound both collision checks to three attempts and preserve published branches', () => {
  for (const name of ['01-publish-branch.md', '11-commit-and-push.md']) {
    requires(name, [
      [
        'three-attempt upper bound',
        /at most three (?:bounded )?reconciliation\/publication attempts/u,
      ],
      ['pre-push live check', /immediately before push/u],
      ['post-push live check', /after push/u],
      [
        'exact full remote ref',
        /git ls-remote --heads origin refs\/heads\/<branch>/u,
      ],
      [
        'remote SHA must match local HEAD',
        /(?:verify the returned exact full ref SHA equals local `HEAD`|require that exact full ref SHA to equal local HEAD)/u,
      ],
      ['owned plan excluded from allocation', /--owned-plan/u],
      [
        'published branch untouched',
        /(?:old branch is published, leave it untouched|leave any published branch untouched)/u,
      ],
      [
        'replacement from current HEAD',
        /(?:replacement branch from current HEAD|replacement from current HEAD)/u,
      ],
      ['no force push or amend', /(?:Do not|Never) force-push, amend/u],
      [
        'nonfatal partial publication',
        /(?:partial publication honestly|honest partial status)/u,
      ],
    ]);
  }
  requires('01-publish-branch.md', [
    [
      'exact same branch is reusable',
      /same branch name is not itself a numeric collision/u,
    ],
    ['push is not a reservation', /push does not atomically reserve a number/u],
    [
      'rename only owned unpublished branch',
      /Rename only a safe, unpublished branch proven flow-owned/u,
    ],
    [
      'competitor branches remain',
      /Do not overwrite or delete competing branches/u,
    ],
    ['safe normal push', /git push -u origin HEAD/u],
    [
      'bounded post-push race recovery',
      /After push, recheck live same-namespace numbers[^.]+reconcile within the three-attempt limit/u,
    ],
    [
      'rerun reuses corrected identity',
      /A rerun must reuse a valid corrected identity/u,
    ],
  ]);
  requires('11-commit-and-push.md', [
    [
      'final same-branch reuse',
      /Exact same-branch remote presence alone is not a numeric collision/u,
    ],
    [
      'competitor refs and credentials remain',
      /Never force-push, amend, delete competitors, change credentials/u,
    ],
  ]);
});

test('final retrospective collision repair stages verified tracked plan deletions and commits the correction before verifying remote HEAD', () => {
  requires('11-commit-and-push.md', [
    [
      'replacement destination unoccupied',
      /verify its destination is unoccupied/u,
    ],
    ['old/new identity recorded', /record old → new plan paths/u],
    [
      'tracked old plan deletion included',
      /prior flow-owned plan path only when it is tracked and verified deleted/u,
    ],
    [
      'absent untracked plan omitted',
      /never use an absent untracked pathspec/u,
    ],
    ['stage only explicit owned paths', /git add -A -- <story paths>/u],
    [
      'unrelated staged changes preserved',
      /git commit --only -- <story paths>/u,
    ],
    [
      'ignored controls cannot be force-added',
      /Never force-add ignored controls or receipts/u,
    ],
    [
      'superseded handoff ownership required',
      /Superseded tracked handoff\/control deletions require verified ownership and preservation/u,
    ],
    [
      'correction committed before retry',
      /commit the story-only renumber change before retrying/u,
    ],
    [
      'actual remote branch checked',
      /git ls-remote --heads origin refs\/heads\/<branch>/u,
    ],
    [
      'remote SHA equals local HEAD',
      /require that exact full ref SHA to equal local HEAD before claiming publication success/u,
    ],
    ['no approval pause', /Do not request confirmation/u],
  ]);
});
