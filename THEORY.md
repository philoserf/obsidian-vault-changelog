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

### The plugin destroys a file it cannot identify

`changelogPath` is free text naming any note in the vault, and `writeToFile` replaces that note's
contents in full. The only validation is `isValidChangelogPath`, which tests for a `.md`
suffix — satisfied by every note there is. The path autocomplete offers existing notes as
completions for that very field.

No predicate anywhere asks whether the file about to be overwritten is one this plugin wrote. A
guard for this was attempted and withdrawn; see the finding below before reaching for it again.

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

## Uncertainties

Where I am inferring from code alone, and where you should check rather than trust me.

**`normalizePath`'s behaviour is inferred, not observed.** The package has no runnable
JavaScript. What it returns for empty or separator-only input decides whether
`validateExcludedFolder`'s guards catch the case they were written for, and that cannot be
settled here.

**`main.ts` and `settings.ts` have no test coverage at all**, by design. Every claim in this
document about the settings tab, the event wiring and the write path comes from reading, not from
running.

**Whether the thin spots above are accepted or simply unaddressed, I cannot tell you.** Nothing
in the code records a judgement on them, and this document does not manufacture one. Read them as
described, not as prioritised.

## Findings

| Finding                                                                                                                                                                                                                                                                             | Where                         | Status                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| The plugin destroys a file it cannot identify — see the third thin spot above. A guard was attempted and failed in both directions, accepting ordinary notes and refusing files the plugin had itself written; the failure modes are recorded so it is not reattempted the same way | `src/main.ts` — `writeToFile` | [#250](https://github.com/philoserf/obsidian-vault-changelog/issues/250) |
