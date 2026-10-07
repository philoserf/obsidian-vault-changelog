# Theory

What you need to hold in mind to change Vault Changelog without damaging it. `WALKTHROUGH.md` is
the tour of the code; this is the set of ideas the code expresses, and the places where holding
the wrong one will do harm.

## What the system is for

A vault is a directory of markdown notes. Obsidian offers no good answer to "what have I been
working on lately" — the file list is alphabetical, the graph is topological, and neither is
chronological. This plugin answers it by maintaining one note that lists the most recently
modified notes, newest first, as links.

The name misleads, and that is the first thing to get straight.

**This is not a changelog. It is a view.** Nothing accumulates, nothing merges, no history
survives. Each update computes the entire file from the vault's current state and writes it over
whatever was there. A note edited today and deleted tomorrow leaves no trace — it is simply
absent from the next render, as though it had never appeared. The file's contents are a function
of `(files, settings)`, and the plugin's whole job is to keep the note at `changelogPath` equal
to that function's value.

Hold that and the design follows. Hold "it is a log" and you will reach for appends, diffs and
reconciliation, none of which this system has or can support.

The vocabulary is small and worth pinning down:

- An **entry** is one rendered row — a timestamp and a name, separated by a middle dot.
- The **changelog** is the note at `changelogPath`. It is the plugin's output, not its state.
- An **excluded folder** is a path prefix whose notes never become entries.
- `filterAndSort` decides _which_ notes appear; `generateChangelog` decides _how they read_.

## The one organizing idea

`src/changelog.ts` has no imports. Not Obsidian, not `moment`, not anything. That is a hard line
rather than a stylistic preference, and it is the reason this project has a test suite at all:
every decision worth testing — which notes qualify, what order they take, how a row reads, what a
persisted setting means — is reachable from `bun test` with no Obsidian running.

The line is held by **handing the module what it would otherwise reach for**, in exactly two
places:

- **Time formatting** arrives as a `TimeFormatter` callback. Production closes over Obsidian's
  globally-installed moment; tests pass the npm `moment` package. This is why `moment` is a
  devDependency and never ships.
- **Path normalization** arrives as a function parameter to `normalizeLoadedSettings`. Production
  passes Obsidian's `normalizePath`; tests pass `identity`, or a trailing-slash stripper where
  the case turns on normalization.

`ChangelogFile` completes the idea. It is a structural interface naming the three fields the core
actually reads — `path`, `basename`, `stat.mtime`. A real `TFile` satisfies it; so does an object
literal. Nothing casts and nothing is mocked, anywhere in the suite.

The price is stated plainly: `main.ts` and `settings.ts` have **no test coverage by
construction**. That is the bargain, and it only pays while the decisions stay on the pure side.
When you add behaviour, "can this live in `changelog.ts`?" is the design question, not a matter
of taste — a rule that ends up inside an event handler is a rule no test will ever reach.

**This is the part of the design to protect.** What follows is where it is not yet doing the work
it could.

## Where the theory is thin

A theory should say where it stops holding. Here it stops in three places, and they share a
shape: **a decision that belongs in the pure layer is being made in the shell, or made twice.**

### Settings are validated at two boundaries that do not share their rules

Settings arrive from two directions, neither trustworthy. `data.json` is hand-editable,
sync-corruptible, and may have been written by an older version. The settings tab is a person
typing.

`clampMaxRecentFiles` is the one rule both boundaries call, and its doc comment says so
explicitly. **No other field works that way**, and the two sides have drifted apart in
consequence:

| Field              | Settings tab                     | Loader                       |
| ------------------ | -------------------------------- | ---------------------------- |
| `changelogPath`    | must end `.md`, else reverts     | no extension check at all    |
| `datetimeFormat`   | empty is replaced by the default | empty is kept                |
| `excludedFolders`  | root markers rejected            | no per-element check         |
| `maxRecentFiles`   | `clampMaxRecentFiles`            | `clampMaxRecentFiles`        |
| `changelogHeading` | `.trim()` inline                 | `.trim()` inline, separately |

So a persisted value can be one the settings tab would refuse to display. An empty
`datetimeFormat` is the quietest of these: `moment().format("")` does not fail, it yields a full
ISO-8601 timestamp, so every row silently changes shape.

The cost is not the current divergences — those are finite and could each be patched. It is that
an eighth setting will acquire the same split, in whichever of the two places the author was not
looking.

### Nothing owns the invariant "memory matches disk"

Every settings change is an assignment into the plugin's settings object followed by a
fire-and-forget `saveSettingsSafely()`. There are eight such pairs and they are uniform, which is
what makes it easy to read them as repetition rather than as structure.

**There is no single point at which "a setting changed" happens.** When the write fails, the
assignment has already occurred and nothing puts it back, so the plugin runs on a value that was
never persisted until a restart reverts it. The rollback has nowhere to live: by the time the
save is attempted, the previous value is gone and no one kept a copy.

The same absence explains why two save methods exist. `saveSettings` wraps `saveData`,
`saveSettingsSafely` wraps `saveSettings` and swallows the rejection, and all eight call sites
use the second. "Persist, and handle failure" is a real step with no home, so it grew beside the
raw write instead of replacing it.

Editing in place has a second edge. `excludedFolders` is the one setting held by reference, and
the tab changes it with `push` and `splice`. The array the tab edits is a fresh one only because
`normalizeLoadedSettings` ends by mapping the folders through `normalize`. Before that line, the
shallow spread over `DEFAULT_SETTINGS` and the malformed-data fallback both hand back the
default's own array. That line exists to normalize paths, and its copy is incidental, so
removing it in a refactor would let the user's folders leak into `DEFAULT_SETTINGS`.

### The plugin destroys a file it cannot identify

`changelogPath` is free text naming any note in the vault, and `writeToFile` replaces that note's
contents in full. The only validation is `isValidChangelogPath`, which tests for a `.md`
suffix — satisfied by every note there is. The path autocomplete offers existing notes as
completions for that very field.

No predicate anywhere asks whether the file about to be overwritten is one this plugin wrote. A
guard for this was attempted and withdrawn; read
[#250](https://github.com/philoserf/obsidian-vault-changelog/issues/250) before reaching for it
again.

## Seams

**Obsidian.** Confined to `main.ts` and `settings.ts`, and the surface used is small: `Plugin`,
vault events plus create/modify/getAbstractFileByPath, `normalizePath`, `debounce`, `Notice`,
`PluginSettingTab`, `AbstractInputSuggest`. Note the package ships **type declarations only** —
there is no JavaScript in it — so nothing from Obsidian can be executed in a test or a probe.
That is why a question like "what does `normalizePath` return for empty input" cannot be settled
from inside this repository, and why code that depends on the answer should be written to be
correct under every plausible one.

**The vault event stream.** `modify`, `delete` and `rename`, all gated on `autoUpdate` and routed
through a single 200 ms debounce. Two details are load-bearing and both are currently wrong in
the same direction — the shell is doing less than it appears to:

- The `debounce` call omits `resetTimer`, which defaults to `false`. The function is therefore a
  throttle, firing 200 ms into a burst and repeating, rather than once after editing stops.
- All three events share one handler, so `rename`'s `oldPath` is discarded. That argument is the
  only value capable of telling the plugin its own changelog has moved.

`onunload` is empty. `registerEvent` releases the listeners; an in-flight debounce is not its
business, so one can still fire against a torn-down instance.

The guard's `file.path !== changelogPath` test looks like a filter, but it is a loop breaker.
`writeToFile` ends in `vault.modify`, which fires the same `modify` event the handler listens
to. Without that comparison, every update would schedule the next one. `filterAndSort` excludes
the changelog as well, but that only keeps the note out of its own list. It does nothing to stop
the loop.

**Sync, and `data.json` changing underneath a running plugin.** A vault is often shared between
devices, and the plugin reads `data.json` exactly once, in `onload`. Nothing implements
`onExternalSettingsChange`, so settings that a sync client changes on disk are invisible until a
restart. Because `saveData` writes the whole settings object, the next edit in a stale settings tab
overwrites the synced copy wholesale, not just the field that changed. The hook has existed
since Obsidian 1.5.7, so every version the plugin supports has it (#264). The changelog note itself syncs too. A synced-in changelog arrives as a `modify`
on `changelogPath` and hits the loop breaker above, so two devices with auto-update on do not
ping-pong. Each device renders from its own view of the vault, and the last write wins.

**The build.** `main.js` is committed because it is the artifact Obsidian loads. CI rebuilds and
runs `git diff --exit-code main.js`, so a source or dependency change without a rebuild cannot
merge. Bun is deliberately unpinned, which means a bundler release that only changes minified
identifier names trips the same check — the committed bundle can go stale without anyone touching
`src/`.

## What the design accommodates

**Another filter dimension.** `filterAndSort` is pure, its tests are cheap, and the prefix-match
subtlety is already pinned.

**Another setting is more work than it looks.** You add the field to `ChangelogSettings` and
`DEFAULT_SETTINGS`, then remember the matching type guard in `normalizeLoadedSettings` — string
tuple or boolean tuple, kept in sync by hand with nothing failing if you forget — and then write
its validation a second time in the settings tab. That is the tax the two-boundary split levies,
and it is where the next divergence will appear.

## What would require rethinking something fundamental

**Any form of history.** "Keep the last N days even if the note was deleted", "show what
changed", "don't drop entries past the cutoff" — each breaks the identity that the file is a
function of current vault state, and would need a durable store the plugin does not have.

**Incremental update.** The whole file is written every time, which is what makes the operation
idempotent and crash-safe, and why no merge logic exists anywhere.

**More than one changelog.** `changelogPath` is a scalar throughout — in the settings, in
`filterAndSort`'s self-exclusion, in the event guard. Several would mean each excluding all the
others, and would need a way to say which changelog a given file is.

**Reacting to a setting changing.** There is no commit path to hang a reaction on. That absence
is worth preserving deliberately: re-registering vault listeners when `autoUpdate` flips is a
listener leak with closed issues already attached to it, and the current design avoids it by
registering once in `onload` and reading `this.settings.autoUpdate` inside the guard.

## What `main` is, and what is scheduled against it

The code on `main` is older than its version number, and the history explains why.

The thin spots above are not undiscovered. Releases 1.6.0 and 1.7.0 addressed most of them,
including a single settings rule per field (`f71caab`, #235), a commit path with rollback
(`2c265d8`, #233), a trailing-edge debounce cancelled on unload (`b058f19`, #225), and tracking
the changelog through a rename (`3712722`, #221). One fix in that set was wrong: the ownership
guard (`cbf7b0b`, #223) failed in both directions (#250). Both releases were withdrawn, and
`5c2d02b` (#246) reverted the **whole** plugin source to 1.5.4, not just the guard. The good
fixes and about three hundred lines of tests went with it. 1.8.0 ships that 1.5.4 source under
a higher number, so that users stranded on 1.6.0 receive an update.

The defects were reopened (#247), and the 2.0.0 milestone takes them and more. It is the last
feature release before maintenance mode (#252) resumes. Its scope is every known bug, the final
improvements, a move to current API usage, and very thorough testing. The current API includes
declarative settings (#261), which raises `minAppVersion` to 1.13.0. The milestone redoes the
reverted fixes from current code rather than restoring the old commits, in a fixed order written
in its description. #263 comes first: fixtures taken from shipped versions, a failing test
before each fix, and a checklist run against a beta in a real vault. That ordering is the lesson
of #250. The guard passed its tests because they only round-tripped the current renderer's own
output. Once 2.0.0 ships, the expectation is maintenance only, so a change that seems to need
another feature release is a change to that plan, not just to the code.

So, for whoever picks this up:

- **The reverted commits are a worked reference, not a patch queue.** Read them for the
  approach. Do not cherry-pick them. Take nothing from `cbf7b0b`, which introduced the guard,
  or from `9ddb158`, which carries it forward.
- **Outside users constrain every change.** This is a community-directory plugin.
  `minAppVersion` is 1.6.6 on `main` and becomes 1.13.0 in 2.0.0. That is a deliberate,
  one-time cut for declarative settings, and any API newer than the floor in force cuts users
  off. `isDesktopOnly` is false, so it runs on iOS. Nothing in `src/` touches Node or Electron. The
  `electron` external in the build scripts is inherited from the template, not a dependency.
  Keep it that way.

## Uncertainties

Where I am inferring from code alone, and where you should check rather than trust me.

**`normalizePath`'s behaviour is inferred, not observed.** The package has no runnable
JavaScript. What it returns for empty or separator-only input decides whether
`validateExcludedFolder`'s guards catch the case they were written for, and that cannot be
settled here.

**`main.ts` and `settings.ts` have no test coverage at all**, by design. Every claim in this
document about the settings tab, the event wiring and the write path comes from reading, not from
running.

**Whether two devices render the same changelog depends on whether a sync client preserves
modification times.** I have not checked how any sync client handles `mtime`. If it does not,
each device lists notes in a different order. The changelog then flips with whichever device
wrote last, and every rewrite is itself a change that syncs.

## Index

| #   | Severity | Issue                                                                                                                                                                                                                                           | Primary location                               |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | medium   | `WALKTHROUGH.md`'s build section quotes `build.ts`, which #254 deleted. The build now lives in `package.json`'s `build` and `dev` scripts. [#265](https://github.com/philoserf/obsidian-vault-changelog/issues/265)                             | `WALKTHROUGH.md` — "Build and release"         |
| 2   | low      | The loader's final `.map` is the only thing keeping the settings tab from mutating `DEFAULT_SETTINGS.excludedFolders`, and no test pins it (see the second thin spot). [#266](https://github.com/philoserf/obsidian-vault-changelog/issues/266) | `src/changelog.ts` — `normalizeLoadedSettings` |

**Total: 2 issues (0 critical, 0 high, 1 medium, 1 low)**

**Related existing findings.** The thin spots and seams above are tracked in the 2.0.0
milestone: settings rules (#213), the commit path (#206, #215), the debounce (#193), unload
(#201), rename (#196), sync reload (#264), and ownership (#197). The failed attempt at ownership
is recorded in [#250](https://github.com/philoserf/obsidian-vault-changelog/issues/250).
