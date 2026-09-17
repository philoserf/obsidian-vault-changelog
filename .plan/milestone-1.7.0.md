# Milestone 1.7.0 — ordered plan

Verified against HEAD `4da5bbb` on 2026-09-17. All 13 open issues confirmed live; none already
fixed, stale in substance, or describing a harmful change. Per-issue verification comments are on
the issues themselves; the corrections that changed this plan are repeated below.

## The one theme

Every issue in this milestone is downstream of a single fact: **settings are validated at two
trust boundaries — `data.json` at load, the settings tab at edit time — and the two copies have
drifted.** #213 names it; #204, #207, #209, #210, #211 and #199 are per-field instances of it;
#215, #216 and #206 are the missing commit path that makes the rules unenforceable; #208 is the
loader shape that has to change before the rules can be lifted out; #200 and #203 are local
defects in the handlers being rewritten anyway.

## Dependency graph

Edges are "must land before", taken from the issues' own sequencing notes and from two
corrections made during verification.

```
#209 (clamp fallback) ────────────┐
                                  ├──> #210 (delete UI pre-check)
#208 (collapse loader) ──┐        │
                         ├──> #213 (per-field rules) ──┘
#204 (root markers) ─────┤         subsumes #207, #211
                         │
#215 (commit path) ──────┘
  closes #216, #206
      ^
      │
#199 + #200 + #203 (handler shape)
```

Three edges are worth stating explicitly because they are easy to get backwards:

1. **#208 before #213**, strictly. #213 lifts one rule per field out of the loader; that is only a
   readable change against the one-expression-per-field shape #208 produces. In the other order
   #213 has to be re-derived against a function that no longer exists. (#213's own words: "That
   one lands first, strictly.")
2. **#204 before #213.** #213's `coerceExcludedFolders` routes every element through
   `validateExcludedFolder` and therefore inherits whatever guard set that function has. #213
   subsumes #211 but explicitly **does not** subsume #204.
3. **#215 before #213** — this reverses the order the issues imply, and is the one sequencing
   decision not taken from an issue body. #213 rewrites all seven UI handlers to call coercion
   rules; #215 rewrites all nine mutation sites onto a commit method. Done in the issues' implied
   order, every handler is rewritten twice. #199/#200/#203 go earlier still, for the same reason:
   #199 moves the datetime field onto `blur`, and doing that first means #213's
   `coerceDatetimeFormat` lands in a `blur` handler once instead of being written into `onChange`
   and immediately moved.

## PR sequence

Seven PRs. Issues are grouped only where they are literally the same edit — each grouping is
justified by the subsuming issue's own text, and every issue gets its own `Closes` line.

| #   | Branch                                        | Closes                 | What                                                                                                                                                                     |
| --- | --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `fix/clamp-max-recent-files-fallback`         | #209                   | Reject non-numeric input before coercing, so `null`/`""`/`[]`/`false` reach the default instead of `1`. Carries this plan file.                                          |
| 2   | `refactor/collapse-normalize-loaded-settings` | #208                   | Build the settings object once, one expression per field. Deletes the known-key filter, both key tuples, the array guard.                                                |
| 3   | `fix/excluded-folder-root-markers`            | #204                   | `ROOT_MARKERS` set, so every shape `normalizePath` can return for "no folder" is rejected.                                                                               |
| 4   | `refactor/settings-commit-path`               | #215, #216, #206       | One `updateSettings(patch)` with rollback on a failed write; deletes `saveSettings` and `saveSettingsSafely`; all nine mutation sites move onto it.                      |
| 5   | `fix/settings-handler-shape`                  | #199, #200, #203       | Datetime preview split from persist (preview on `onChange`, save on `blur`); `datetimePreview` null-guarded; the `duplicate` verdict gets its notice.                    |
| 6   | `refactor/consolidate-settings-rules`         | #213, #207, #211, #210 | One exported rule per field, called by both boundaries with a trailing `fallback`. Absorbs `isValidChangelogPath`, the folder dedup, and the max-recent-files pre-check. |
| 7   | `docs/regenerate-for-1.7.0`                   | —                      | `THEORY.md`, `WALKTHROUGH.md`, `CLAUDE.md` drift.                                                                                                                        |

Every PR touching `src/` ends with `bun run build` and a committed `main.js` — CI runs
`git diff --exit-code main.js` and fails the PR otherwise.

## Decisions taken without asking, and why

Three things in this milestone look like maintainer questions. Each is resolved by something
already written down, so none is being escalated.

- **#210's revert-vs-replace UX question.** #213 gives every rule a trailing `fallback`
  parameter; the handler passes `settings.maxRecentFiles` and keeps today's revert behaviour
  while still having one range rule. That is the conservative branch, and #210 names it as
  acceptable ("the duplication is the finding, not the choice").
- **#215's coercion seam.** Option 1 — the handler coerces and compares, `updateSettings` merges
  and persists without re-validating. #215 argues for it and the alternative would have six of
  nine call sites ignore a return value.
- **#213's load-path behaviour change.** A persisted `changelogPath` without `.md` starts falling
  back to the default. This is not a public-API change — nothing outside this repo imports
  `src/changelog.ts`, and the command, manifest and settings-key schema are untouched — so it
  proceeds, with a `### Changed` entry and an `### Upgrading` note in `CHANGELOG.md`.

## Corrections carried forward from verification

- **Nine `saveSettingsSafely` call sites, not eight.** #215 and #216 both say eight, in
  `settings.ts`. `src/main.ts:66`, in the `rename` handler added for #196 in 1.6.0, is a ninth.
  It must move onto `updateSettings` too, or the commit path has a hole in the one code path that
  changes `changelogPath` without the user present.
- **`display()`'s `const { settings } = this.plugin` must go.** `updateSettings` replaces
  `this.settings` with a new object, which makes the destructured binding a stale snapshot —
  every later `settings.x` read, including #213's `fallback` arguments, would see pre-change
  values. Handlers read `this.plugin.settings.x` at event time instead.
- **The changelog-path notice must compare against the normalized input**, not the raw input, or
  a trailing slash or backslash — which `normalizePath` strips harmlessly — fires a spurious
  "must end with .md".
- Test counts in #207 and #208 ("30 tests") are stale; the suite is 47 at HEAD.
- #206's "no `console.error` anywhere in `src/`" is stale; `main.ts:122` has one. It is on the
  write path, not the settings-save path, so the finding stands.
- #213's `writeToFile` is now `updateChangelog`; only a test description string keeps the old name.

## Tooling substitutions

Two things this milestone's process assumes do not exist in this repository. Both are noted in the
gate report rather than silently worked around.

- **There is no `docs-verify` check.** No script in `package.json`, no CI job, no binary — `grep`
  for it across the repo returns nothing. Substituted: a scratchpad verifier that extracts every
  fenced `ts` block from `THEORY.md` and `WALKTHROUGH.md` and checks each against the cited source
  file, honouring the `...` elision convention the walkthrough's own preamble declares.
- **The `obsidian-gate` and `obsidian-ship` skills named in `CLAUDE.md` are not available** in
  this session. Substituted: `release-gate` for the gate, and the release cut by hand.

## Release

`release.yml` triggers on a bare `X.Y.Z` tag and creates the GitHub release with the three
assets itself — so the tag push _is_ the release. Do not also `gh release create`; the body goes
on afterwards with `gh release edit --notes-file`, which is how 1.6.0's hand-written body got
there. "Live" means `gh release view 1.7.0 --json assets` lists `main.js`, `manifest.json` and
`styles.css`.
