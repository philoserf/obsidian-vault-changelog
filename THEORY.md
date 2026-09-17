# Theory

What you need to hold in mind to change Vault Changelog without damaging it. Not a tour of the
files — `WALKTHROUGH.md` is that. This is the set of ideas the code is an expression of, and the
places where holding the wrong one will cause damage.

## What the system is for

A vault is a directory of markdown notes. Obsidian gives the user no good answer to "what have I
been working on lately", because the file list is alphabetical and the graph is topological.
This plugin answers it by maintaining a note that lists the most recently modified notes, newest
first, each as a link.

The name is the first thing to get straight, because it is wrong in a way that matters.

**This is not a changelog. It is a view.** Nothing accumulates. There is no history. Every update
computes the entire file contents from the vault's current state and writes them over whatever
was there. Run it twice against an unchanged vault and you get the same bytes. A note edited
today and then deleted tomorrow leaves no trace — it is simply absent from the next render, as
though it had never appeared. `renderChangelog` is a pure function from (files, settings) to a
string, and the plugin's entire job is to keep the file at `changelogPath` equal to that string.

Hold that and most of the design follows. Hold "it is a log" and you will reach for appends,
diffs, and merge logic, all of which the system is built to make unnecessary and none of which
it can support.

The domain vocabulary is thin and worth knowing exactly:

- An **entry** is one rendered row: a timestamp and a name, `- 2026-01-02T0930 · [[Note A]]`.
- The **changelog** is the note at `changelogPath`. The plugin owns it (see below).
- An **excluded folder** is a path prefix whose notes never become entries.
- `filterAndSort` decides _which_ notes; `renderChangelog` decides _how they read_.

## The three ideas the code is built on

### 1. A pure core that Obsidian cannot reach

`src/changelog.ts` imports nothing. Not from Obsidian, not from `moment`, not from anywhere. That
is a hard line, not a preference, and it is the reason the project has a test suite at all: the
whole of the decision-making — filtering, sorting, formatting, every settings rule, the ownership
guard — is reachable from `bun test` without a running Obsidian.

The line is held by **injection at every point where the core would otherwise need the app**:

- `TimeFormatter` — production passes `window.moment`; tests pass the npm `moment` package. This
  is why `moment` is a devDependency and never ships.
- `LinkTextResolver` — production passes `MetadataCache.fileToLinktext`, which knows the whole
  vault's link graph and so can tell whether a bare basename is unambiguous. That knowledge is
  exactly what the core must not have.
- `normalize` — Obsidian's `normalizePath`, threaded into `normalizeLoadedSettings` and the two
  path rules.

`ChangelogFile` is the other half of the same idea: a structural type with the three fields the
core actually reads (`path`, `basename`, `stat.mtime`). A real `TFile` satisfies it; so does an
object literal in a test. Nothing casts, nothing mocks.

The cost is stated plainly in the repo's own documentation and is worth repeating: `main.ts` and
`settings.ts` are **untested by construction**. Every decision that matters is supposed to be on
the other side of the line. When you add behaviour, the question "can this live in
`changelog.ts`?" is the design question, not a style preference — a rule that ends up in an event
handler is a rule no test will ever see.

### 2. Settings have two trust boundaries, and every rule is shared between them

This is the newest idea in the codebase and the one most likely to be damaged by someone who does
not know it is there.

Settings arrive from exactly two places, and neither can be trusted:

- **`data.json` at load.** Hand-editable, sync-corruptible, and written by older versions of this
  plugin whose validation rules were different.
- **The settings tab at edit time.** A human typing into a text field.

For most of the plugin's history each boundary validated independently, and they drifted — the
settings tab refused a `changelogPath` without `.md` while the loader accepted one, so a vault
could be actively writing to a file the settings tab would not display. The 1.7.0 milestone
replaced that with a single rule:

> **Every settings rule with a choice in it is one exported function, and both boundaries call
> it.** `coerceChangelogPath`, `coerceDatetimeFormat`, `coerceExcludedFolders`,
> `clampMaxRecentFiles`.

Each rule takes a trailing `fallback`, and that parameter is the whole reason one function can
serve both boundaries, because the boundaries genuinely want different behaviour on bad input:

- **The loader omits it.** At load there is no prior value, so a rejected value becomes the
  default.
- **The settings tab passes the current value.** So a typo in a field reverts to what the user
  had, rather than resetting the setting.

There is one deliberate exception, and it will look like an inconsistency if you do not know why:
**`coerceDatetimeFormat` is called by the settings tab without a fallback.** Clearing that field
is the only reset-to-default gesture it offers, and it has always landed on the default. Passing
the current value would have removed a feature while looking like tidying up.

Two further properties of this layer are load-bearing and easy to destroy by accident:

**Rules run exactly once per edit.** The handler calls the rule, compares the result against what
it was given to decide whether to show a `Notice`, and hands the _coerced_ value to the commit
path, which stores it without re-validating. `updateSettings` carries a comment telling you not
to add a defensive re-validation there; that is not paranoia, it is the difference between one
rule and two call sites that can disagree about which result was stored.

**`normalizeLoadedSettings` builds rather than patches.** It is an object literal reading each
field by name. Nothing from the persisted data is ever spread into the result. Two guarantees
fall out of that construction rather than out of any guard: unknown keys from removed settings
cannot survive a load, and a `__proto__` key in the JSON cannot reach `Object.prototype`. Both
used to be enforced by an explicit known-key filter, which was deleted precisely because
construction is a stronger way to get them. If you rewrite this function back into a spread plus
fixups, you silently give up both.

### 3. The plugin destroys a file it can only identify by shape

`changelogPath` is a free-text setting. It can name any note in the vault, and the plugin
replaces that note's contents wholesale on every update. The obvious guard — "is it a `.md`
file?" — is useless, because every note in the vault is one.

`isPluginGeneratedChangelog` is the real guard, and it works by grammar: every non-empty line,
after an optional leading heading, must look like an entry. Prose fails. A checklist fails. Your
actual notes fail, which is the point — pointing the setting at a real note used to destroy it.

Its **tolerances are deliberate and each encodes a specific past failure**:

- An empty file passes, because `updateChangelog`'s create path lays down `""` before the first
  write, and the guard must not reject the file the plugin itself just created.
- The heading slot accepts _whatever heading is currently in the file_, not the configured one.
  Changing `changelogHeading` must not make the user's own changelog foreign to the plugin that
  wrote it.

That second tolerance is the one to reason from when you touch this function. The guard's job is
to recognise a file written by _whatever version the user had last time_ — which is a
compatibility surface, not an implementation detail. The entry-line pattern has not been given
the same explicit tolerance, and that gap is filed as a finding below.

## Seams

**Obsidian.** Confined to `main.ts` and `settings.ts`. The API surface actually used is small:
`Plugin`, `Vault` events and read/modify/create, `MetadataCache.fileToLinktext`, `normalizePath`,
`debounce`, `Notice`, `PluginSettingTab`, `AbstractInputSuggest`. Note that `obsidian` ships
**type declarations only** — there is no JavaScript in the package, so nothing from it can be
executed in a test or a probe. This is why several decisions in the codebase are written to be
correct under more than one reading of an Obsidian function's behaviour rather than pinned to
the observed one; `ROOT_MARKERS` covering four spellings of the vault root is the clearest case.

**The vault event stream.** `modify`, `delete` and `rename`, all guarded by `autoUpdate` and
debounced 200 ms on the **trailing** edge. Two details are scar tissue:

- The `debounce` call passes `resetTimer: true` explicitly, because it defaults to `false`, which
  makes `debounce` a _throttle_ — firing 200 ms into a burst and repeating. With autosave on, that
  rewrote the whole changelog several times a second.
- `rename` is handled separately from the other two because it alone carries `oldPath`, which is
  the only value that can say the renamed file _was_ the changelog. Without it the plugin's
  identity check compares against a stale path, the changelog lists itself, and the next write
  recreates a ghost at the old name.

`onunload` cancels the pending timer. `registerEvent` handles the listeners; the timer is the one
thing it does not clean up.

**The settings commit path.** `updateSettings(patch)` is the only way settings change — from the
tab and from the rename handler alike. It keeps the previous object, merges, and **restores the
previous object if the write rejects**, so memory and disk cannot silently diverge. Two things
about it are non-obvious:

- `excludedFolders` is _replaced_, never `push`ed or `splice`d. A mutation of the shared array
  would survive the rollback restoring the object reference, which would defeat the whole
  mechanism in the one case it exists for.
- The settings tab must not close over a `settings` binding captured in `display()`.
  `updateSettings` replaces the object, so such a binding is a snapshot that goes stale on the
  first edit. Handlers read `this.plugin.settings` at event time. The one surviving destructure
  is for the controls' _initial_ values, which are read during `display()` and are correct.

**The build.** `main.js` is committed, because that is the artifact Obsidian loads. CI runs
`bun run build` and then `git diff --exit-code main.js`, so any change to `src/` or to a
dependency that is not followed by a rebuild fails the PR. Bun is deliberately unpinned, so a
bundler-output shift trips the same check; the fix is the same either way.

## What this is shaped to accommodate

**Another setting.** Add the field to `ChangelogSettings` and `DEFAULT_SETTINGS`, write its rule
in `changelog.ts` with a trailing `fallback`, call it from `normalizeLoadedSettings` and from the
handler. The typechecker will tell you if the object literal is not exhaustive. That is the whole
procedure, and it is the procedure the 1.7.0 work existed to create.

**Another output format.** `renderChangelog` is the one render entry point and takes the whole
settings object, so a new setting that affects output does not widen a signature. But see the
entry-line finding first: the ownership guard reads the output format, and the two must stay
compatible across versions, not just within one.

**Another filter dimension.** `filterAndSort` is pure and its tests are cheap.

## What would require rethinking something fundamental

**Any form of history.** "Keep the last N days even if the note was deleted", "show what changed",
"don't lose entries older than the cutoff" — all of these break the identity that the file is a
function of current vault state. They would need a durable store the plugin does not have, and
they would break `isPluginGeneratedChangelog`, which recognises the file by the fact that it
contains nothing but freshly rendered entries.

**Incremental update.** The plugin writes the whole file every time. This is what makes the
operation idempotent and crash-safe, and it is why there is no merge logic anywhere.

**More than one changelog.** `changelogPath` is a scalar throughout — in the settings, in the
rename handler's identity check, and in `filterAndSort`'s self-exclusion. Several changelogs
would mean each one excluding all the others, and the ownership guard would have to distinguish
_which_ changelog a file is.

**Anything that reacts to a setting changing.** The commit path deliberately has no side effects.
Re-registering vault listeners when `autoUpdate` flips is the bug behind two closed issues; the
handlers are registered once in `onload` and read `this.settings.autoUpdate` inside the guard.
A commit path is an inviting place to put "and now react to the change", and that particular
reaction is a regression with two issue numbers already attached to it.

## Uncertainties

Where I am inferring from code alone, and where you should check rather than trust me.

**`normalizePath`'s behaviour is inferred, not observed.** The `obsidian` package has no runnable
JavaScript, so nothing in this repository can execute it. `ROOT_MARKERS` covers four spellings of
the vault root because I could not determine which one an empty input actually produces. The
guard is correct under every reading, but if you ever learn the real answer, the set could shrink
and the comment explaining it should change.

**The idempotency of `normalizePath` is assumed by the changelog-path handler**, which compares a
rule's output against a separately normalized value. Filed below.

**I am confident about the _what_ of the 1.7.0 settings consolidation and less so about its
edges.** The `fallback` parameter's split — loader omits, tab passes current, datetime tab passes
neither — is coherent and documented in the functions themselves, but it is three different
behaviours from one signature, and I cannot rule out that a fourth boundary would want a fourth.

**`src/main.ts` and `src/settings.ts` have no test coverage at all**, by design. Every claim in
this document about the settings tab's behaviour, the rollback, and the event wiring is from
reading, not from execution. The typechecker carries real weight there —
`Partial<ChangelogSettings>` rejects a misspelled key — but it cannot see a handler that reads a
stale binding or a notice that fires on the wrong condition.

**The plugin's behaviour on a `data.json` written by 1.6.x and earlier changed in 1.7.0**, and I
am reasoning about that from the code rather than from a migration I watched. A persisted
`changelogPath` without `.md`, an empty `datetimeFormat`, or an `excludedFolders` holding a root
marker now load differently than they did. This is intended and is recorded in `CHANGELOG.md`,
but it is the class of change where an unnoticed case is most likely.

## Findings

Filed during this pass. Each is a discrete, actionable tension between the code and the theory
above — not an uncertainty, which belongs in the section before this one.

| Finding                                                                                                                                                                                                         | Severity | Where                                          | Status                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `changelogHeading` is the one setting whose rule is still implemented at both boundaries, against the principle the rest of the layer now follows                                                               | medium   | `src/changelog.ts:164`, `src/settings.ts:249`  | [#236](https://github.com/philoserf/obsidian-vault-changelog/issues/236) |
| The ownership guard's entry-line grammar is coupled to the renderer's output format, and the round-trip test pins agreement only within a single build — not the cross-version recognition the guard exists for | medium   | `src/changelog.ts:172`, `src/changelog.ts:295` | [#237](https://github.com/philoserf/obsidian-vault-changelog/issues/237) |
| The changelog-path handler normalizes twice and compares against the middle result, so its error notice depends on an idempotency assumption nothing states or can test                                         | low      | `src/settings.ts:130-146`                      | [#238](https://github.com/philoserf/obsidian-vault-changelog/issues/238) |
