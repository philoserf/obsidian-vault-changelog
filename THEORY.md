# Theory

What you need to hold in mind to change Vault Changelog without damaging it. Not a tour of the
files — `WALKTHROUGH.md` is that. This is the set of ideas the code is an expression of, and the
places where holding the wrong one will cause damage.

**This describes 1.5.4.** The 1.6.0 and 1.7.0 releases were withdrawn and their code reverted off
`main`. That matters for reading this document: the architecture below is the one that _preceded_
a milestone which attacked most of its weak points, so where this theory says a boundary is thin,
that is a live assessment and not a hypothetical.

## What the system is for

A vault is a directory of markdown notes. Obsidian gives no good answer to "what have I been
working on lately" — the file list is alphabetical and the graph is topological. This plugin
answers it by maintaining a note listing the most recently modified notes, newest first, as
links.

The name is the first thing to get straight, because it misleads.

**This is not a changelog. It is a view.** Nothing accumulates. There is no history. Every update
computes the whole file from the vault's current state and writes it over whatever was there. A
note edited today and deleted tomorrow leaves no trace — it is simply absent from the next
render. The output is a pure function of (files, settings), and the plugin's entire job is to
keep the file at `changelogPath` equal to that function's result.

Hold that and most of the design follows. Hold "it is a log" and you will reach for appends,
diffs and merge logic, none of which this system can support.

The vocabulary is thin and worth knowing exactly:

- An **entry** is one rendered row: a timestamp and a name.
- The **changelog** is the note at `changelogPath`.
- An **excluded folder** is a path prefix whose notes never become entries.
- `filterAndSort` decides _which_ notes; `generateChangelog` decides _how they read_.

## The organizing idea: a pure core Obsidian cannot reach

`src/changelog.ts` imports nothing. Not Obsidian, not `moment`, not anything. That is a hard line
and it is the reason the project has a test suite at all: filtering, sorting, formatting, settings
normalization and validation are all reachable from `bun test` without a running Obsidian.

The line is held by **injection at the two points where the core would otherwise need the app**:

- A `TimeFormatter` callback. Production passes `window.moment`; tests pass the npm `moment`
  package, which is why `moment` is a devDependency and never ships.
- A `normalize` function, threaded into `normalizeLoadedSettings`. Production passes Obsidian's
  `normalizePath`.

`ChangelogFile` is the other half of the same idea: a structural type with the three fields the
core actually reads — `path`, `basename`, `stat.mtime`. A real `TFile` satisfies it; so does an
object literal in a test. Nothing casts, nothing mocks.

The cost is stated plainly: `main.ts` and `settings.ts` are **untested by construction**. Every
decision that matters is supposed to be on the other side of the line. When you add behaviour,
"can this live in `changelog.ts`?" is the design question — a rule that ends up in an event
handler is a rule no test will ever see.

**This is the part of the design to preserve.** Almost everything below is a place where the
boundary is not yet doing the work it could.

## Where the theory is thin

A theory should say where it does not hold. Here it does not hold in four specific places, and
they share a shape: **a decision that has a home in the pure layer is being made in the shell, or
made twice.**

**Settings are validated at two trust boundaries that do not share rules.** Settings arrive from
`data.json` at load and from the settings tab at edit time. Neither can be trusted — the first is
hand-editable and sync-corruptible, the second is a human typing. `clampMaxRecentFiles` is the
one rule both boundaries call, and its doc comment says so explicitly. No other field works that
way. The settings tab rejects a `changelogPath` without `.md`; the loader accepts one. The tab
substitutes a default for an empty datetime format; the loader keeps the empty string, and
`moment().format("")` silently yields a full ISO-8601 timestamp rather than failing. The tab
rejects a root-marker excluded folder; the loader stores it. A persisted value can therefore be
one the settings tab would refuse to display.

**Nothing owns the memory/disk invariant.** Every settings mutation is an assignment into the
plugin's settings object followed by a fire-and-forget `saveSettingsSafely()`. There are eight of
these. When the write fails the assignment has already happened and nothing rolls it back, so the
plugin runs on a value that was never persisted until a restart reverts it. There is nowhere to
put the rollback, because by the time the save is attempted the old value is gone.

**The plugin destroys a file it cannot identify.** `changelogPath` is free text naming any note
in the vault, and `writeToFile` replaces that note wholesale. The only guard is `.md`, which
every note satisfies. The path autocomplete offers existing notes as completions, so selecting
one is a single click. There is no predicate anywhere that asks whether the file about to be
overwritten is one this plugin wrote.

**The render contract is positional and ordered.** `updateChangelog` calls `filterAndSort` and
then `generateChangelog`, nine arguments across two calls, and the second formats whatever list
it is given without filtering. Nothing enforces the ordering; a caller that skips the first step
gets an unfiltered changelog.

## Seams

**Obsidian.** Confined to `main.ts` and `settings.ts`. The surface used is small: `Plugin`,
`Vault` events and read/modify/create, `normalizePath`, `debounce`, `Notice`,
`PluginSettingTab`, `AbstractInputSuggest`. Note the package ships **type declarations only** —
there is no JavaScript in it — so nothing from Obsidian can be executed in a test or a probe.
That is why questions like "what does `normalizePath` return for empty input" cannot be settled
from this repository.

**The vault event stream.** `modify`, `delete` and `rename`, all guarded by `autoUpdate` and
routed through one debounce. Two things to know:

- The `debounce` call omits `resetTimer`, which defaults to `false` and makes the function a
  throttle — it fires 200 ms into a burst and repeats, rather than waiting for editing to stop.
- All three events share a handler, so `rename`'s `oldPath` is discarded. The changelog's own
  path is the one value that argument could correct, and moving the changelog note leaves the
  setting stale.

`onunload` is empty. `registerEvent` releases listeners; the debounce timer is not its business.

**The build.** `main.js` is committed, because that is the artifact Obsidian loads. CI runs
`bun run build` then `git diff --exit-code main.js`, so any source or dependency change without a
rebuild fails the PR. Bun is deliberately unpinned, so a bundler-output shift trips the same
check — identifier mangling alone is enough — and the fix is the same: rebuild and commit.

## What this is shaped to accommodate

**Another filter dimension.** `filterAndSort` is pure and its tests are cheap.

**Another setting** is more work than it looks. You add the field to `ChangelogSettings` and
`DEFAULT_SETTINGS`, then remember the matching type guard in `normalizeLoadedSettings` — the
string tuple or the boolean tuple, kept in sync by hand with nothing failing if you forget — and
then write its validation a second time in the settings tab. That is the cost the two-boundary
split imposes, and it is where an eighth setting will acquire the same divergence the existing
seven have.

## What would require rethinking something fundamental

**Any form of history.** "Keep the last N days even if deleted", "show what changed" — all break
the identity that the file is a function of current vault state.

**Incremental update.** The whole file is written every time. That is what makes the operation
idempotent and crash-safe, and why there is no merge logic anywhere.

**More than one changelog.** `changelogPath` is a scalar throughout — in the settings, in the
self-exclusion in `filterAndSort`, in the event guard. Several would mean each excluding all the
others.

**Reacting to a setting change.** There is no commit path to hang a reaction on, and that is
load-bearing rather than accidental: re-registering vault listeners when `autoUpdate` flips is a
listener leak with closed issues already attached to it. The handlers are registered once in
`onload` and read `this.settings.autoUpdate` inside the guard.

## Uncertainties

**`normalizePath`'s behaviour is inferred, not observed.** The `obsidian` package has no runnable
JavaScript. What it returns for empty or separator-only input decides whether
`validateExcludedFolder`'s guards actually catch the case they are written for, and that cannot
be settled here.

**`main.ts` and `settings.ts` have no test coverage at all**, by design. Every claim in this
document about the settings tab, the event wiring and the write path comes from reading, not
execution.

**This theory describes reverted code, and I did not witness the decision to revert it.** The
1.6.0/1.7.0 milestone addressed most of the thin spots in the section above. Whether those
weaknesses are acceptable, or simply pending a differently-packaged fix, is a question the commit
history does not answer and this document should not pretend to.

## Findings

| Finding                                                                                             | Where       | Status                                                                       |
| --------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| Thirteen defects fixed in 1.6.0/1.7.0 are present again on `main`, while their issues remain closed | `src/`      | see [#247](https://github.com/philoserf/obsidian-vault-changelog/issues/247) |
| README has no troubleshooting for failed installs and updates on Windows                            | `README.md` | [#244](https://github.com/philoserf/obsidian-vault-changelog/issues/244)     |
