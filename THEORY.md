# Theory

For the engineer inheriting this plugin. This is not a tour of the files; it is the set of ideas
you need to hold in mind so that a change you make does not quietly break something the code
assumes but never states.

References here name a file and a symbol rather than a line range, because line ranges drift and
nothing in this repository checks them.

## The one idea everything else hangs from

The name is a lie the codebase maintains on purpose, and understanding that is most of the theory.

There is no log here. Nothing accumulates. `renderChangelog` in `src/changelog.ts` is a pure
function of the vault's current state — take every markdown file, sort by `stat.mtime`
descending, keep the first _n_, render one line each. Run it twice against an unchanged vault and
you get the same string, byte for byte. Nothing about the previous run is consulted, and nothing
about the current run is remembered.

So the file at `changelogPath` is **cache, not data**. It is a materialized view of a query whose
source of truth is the vault's own filesystem metadata, and it can be thrown away and regenerated
at any moment at no cost. Once you see the file that way, nearly every decision in this codebase
stops looking like a shortcut and starts looking like the obvious consequence:

- `updateChangelog` calls `vault.modify` with the whole rendered string. There is no merge, no
  append, no plugin-managed region between markers. Overwriting is not vandalism when the thing
  being overwritten is derived.
- There is no locking and no ordering discipline between the command path and the vault-event
  path. Two overlapping updates can only race to write the same answer.
- The TOCTOU handling inside `updateChangelog` is tolerant rather than careful: if `vault.create`
  throws, it assumes a concurrent event won the race, re-fetches by path, and proceeds. That is
  only safe because whoever won was going to write the same content.
- Failure is reported and dropped, never retried. `runUpdate` is the single place that happens.
  Nothing retries because the next vault event regenerates everything anyway; a dropped update is
  a stale cache, not lost work.

The README says the quiet part out loud for users — "the changelog note is entirely overwritten
on each update" — and that sentence is the user-facing shadow of this theory.

The corollary is the sharpest thing to know: **any requirement that asks the changelog to
remember something is not a feature request, it is a request to discard the theory.** Appending
rather than replacing, recording deletions, diffing against the last run, grouping entries by day
across runs — none of those are additions to the current design. Each one turns the file from
cache into data, and once it is data the overwrite has to go, the races start to matter, and the
dropped updates become bugs. If that requirement arrives, budget for a rewrite of `main.ts`, not
a patch.

### Where that idea has started to strain

Worth naming, because it is the most interesting thing in the current codebase and it is new.

The ownership guard added in 1.6.0 — `isPluginGeneratedChangelog`, called from `updateChangelog`
— refuses to overwrite a file that does not look like something this plugin wrote. Read against
the theory above, that is a slightly odd thing to want. If the file is pure cache, protecting its
contents is protecting nothing.

The reconciliation is that the guard exists to protect files that were **never the cache in the
first place**: `changelogPath` can be pointed at any note in the vault, and before the guard,
doing so destroyed it on the next edit. So the guard is not defending the cache; it is defending
everything that is _not_ the cache from being mistaken for it.

But notice what it also does, unavoidably: a user who hand-annotates their changelog makes it
foreign, and the plugin then refuses to touch it. That is the theory admitting, quietly, that the
file can become data if a human decides it has. The guard cannot tell "your note" from "your
annotated changelog," and the design chose to refuse both rather than destroy either. If you ever
find yourself wanting to relax that, understand you are choosing which of the two theories the
file obeys — and that is a real decision, not a tuning knob.

## The pure core and the shell around it

`src/changelog.ts` imports nothing from `obsidian`. That is not incidental tidiness; it is an
enforced boundary, and three injection points exist solely to hold it.

**`TimeFormatter`.** `renderChangelog` takes a `(mtime, format) => string` callback rather than
reaching for moment itself. In production `main.ts` passes Obsidian's globally-installed moment,
so nothing is bundled. Tests pass the npm `moment` package, which is why `moment` is a
devDependency and never appears in the shipped bundle. Same behavior, two different moments, and
the pure layer knows about neither.

**`normalize`.** `normalizeLoadedSettings` takes a path normalizer as an argument instead of
importing Obsidian's `normalizePath`. Tests pass `identity` and can therefore assert that
normalization is _called_ on the right fields without needing Obsidian's implementation.

**`LinkTextResolver`.** The newest, and the clearest illustration of why the pattern exists.
`renderChangelog` does not decide what to call a file; it asks. Production passes
`metadataCache.fileToLinktext`, whose rule is "if the file name is unique, use the filename; if
not unique, use the full path." That rule needs the whole vault's link graph — precisely the kind
of knowledge the pure module must not have — so it arrives as a function, exactly as the clock
did.

A fourth boundary is quieter and easy to break by accident. `filterAndSort` and `renderChangelog`
accept `ChangelogFile[]`, the narrowest structural subset of Obsidian's `TFile` they actually
touch: `path`, `basename`, and `stat.mtime`. A real `TFile` satisfies it, so `main.ts` passes
`getMarkdownFiles()` straight through with no adapter; a three-field object literal in a test
satisfies it too. The temptation, when you need one more property, is to widen it to `TFile` —
that single edit would drag `obsidian` into the pure module and collapse the whole arrangement.
Add the field to `ChangelogFile` instead.

`src/settings.ts` and `src/main.ts` are the shell. Everything Obsidian-shaped lives there:
`Plugin` lifecycle, vault event registration, `PluginSettingTab`, `AbstractInputSuggest`,
`Notice`, `debounce`, `metadataCache`. The shell is meant to hold no decisions, only wiring.

The ownership guard is worth reading as a test of that rule, because it would have been easy to
put in the wrong place. The _decision_ — does this file look like one we wrote — is a pure string
predicate in `changelog.ts`, with tests. The _I/O_ — a `vault.read` to get the content to ask
about — is one line in the shell. Written inline in `main.ts`, where the content already was, it
would have been untestable by construction, and the property that matters most about it could
never have been pinned.

## The invariants

Five things must stay true. Three are enforced and two are not, and knowing which is which is the
difference between a safe change and a damaging one. One of them moved columns in 1.6.0, which is
the largest single change to this document.

**Settings are valid the moment they are loaded, and `normalizeLoadedSettings` is the only gate.**
It is deliberately paranoid about `data.json`, which a user can hand-edit and a failed write can
truncate. It drops keys it does not recognize, so a setting you rename does not leave its
predecessor lying around forever. It replaces any known key whose runtime type is wrong with the
default — the `typeof` sweep over the string keys, then the boolean keys, then the `every` check
on `excludedFolders`, which throws away the whole array if a single element is not a string. Then
it normalizes, clamps and trims. **When you add a setting, add it to `DEFAULT_SETTINGS` _and_ to
the matching type-guard loop.** Adding only the first compiles, passes the tests, and silently
ships a setting a corrupt `data.json` can turn into `undefined` at runtime. This is the most
likely way to damage the system while believing you followed the pattern. _Not enforced — nothing
fails if you forget._

**`clampMaxRecentFiles` is the single clamping authority.** Load-time calls it; the settings UI
calls it. Its own comment says so. The two paths previously disagreed about floats and about the
upper bound, and reconciling them is what 1.5.3 was for. Do not re-implement the rule at a third
call site. _Not enforced — and the settings tab still carries a redundant low-end pre-check that
disagrees with it, which is why `maxRecentFiles` reads as consolidated while behaving as though
it is not._

**The changelog never triggers its own regeneration.** The shared vault-event handler checks three
things before touching the debouncer: auto-update is on, the subject is a `TFile`, and its path is
not `changelogPath`. That third check is the loop breaker — `vault.modify` on the changelog fires
a `modify` event, and without the guard the plugin would rewrite the file in response to having
rewritten the file. The guards sit _before_ the debounce rather than inside the callback, which
was deliberate: put them after, and the debouncer's pending state gets set by events that should
have been ignored. _Enforced, in the handler._

**The committed `main.js` matches a fresh build of `src/`.** Obsidian ships the committed bundle,
so `main.js` is a tracked build artifact rather than build output. CI runs `bun run build` then
`git diff --exit-code main.js`, which fails the PR if the two diverge. `bun` is deliberately left
unpinned so that a bundler-output change trips the same wire. _Enforced, by CI._

**The file at `changelogPath` belongs to the plugin.** This is the assumption the whole overwrite
rests on, and until 1.6.0 nothing enforced it: `isValidChangelogPath` checks only that the path
ends in `.md`, which every note in the vault does, and `PathSuggest` cheerfully offered every one
of them as a completion. Two changes closed it — the suggester now offers folders only, and
`updateChangelog` reads the file and refuses when `isPluginGeneratedChangelog` says it is not
something this plugin wrote. _Enforced, as of 1.6.0._

Read that predicate before changing it, because its **tolerance** is the interesting part rather
than its strictness. It accepts an empty file (the create path lays down `""` first), a file
holding only the configured heading (a heading over an empty vault), and entries under _whatever
heading is currently there, recognized or not_. That last clause is load-bearing: comparing
against the configured `changelogHeading` would mean that changing that setting makes the user's
own changelog foreign, and the plugin refuses to update the very file it wrote until the user
clears it by hand.

The property that matters most is that the guard must never refuse `renderChangelog`'s output. A
guard that rejected what the renderer produces would brick auto-update completely, and nothing
else in the suite would catch it — so there are seven round-trip cases pinning it across heading,
link-mode and duplicate-basename combinations. If you touch either the renderer's line format or
`ENTRY_LINE`, those are the tests that will tell you.

## Vocabulary worth learning before you touch it

**Excluded folders are stored without a trailing slash and matched with one.** In `filterAndSort`,
`file.path.startsWith(folder.endsWith("/") ? folder : folder + "/")` looks like a bug the first
time you read it. Both halves are live: `normalizePath` strips trailing slashes, so anything saved
through the settings UI arrives as `Archive`, but the setting predates that normalization, so a
long-lived `data.json` can still hold `Archive/`. The slash is re-added at match time rather than
at save time because the alternative — a migration — would have to run against persisted user
data. And the slash matters: without it, excluding `Notes` would also exclude `Notes2/` and
`Notebook/`. There is a test named exactly `does not exclude folders that share a prefix`, which
is the tell that someone was burned by it.

**`changelogHeading` is written literally and trimmed at both boundaries.** `renderChangelog`
emits `heading + "\n\n"` when non-empty and nothing at all when empty. That two-newline spacing is
only predictable if the heading carries no leading or trailing whitespace, which is why it is
trimmed on load _and_ on change.

**"Verdict" means a three-valued answer, not a boolean.** `ExcludedFolderVerdict` is
`"ok" | "invalid" | "duplicate"`, and the type exists so the caller can say something different
about each failure. The caller currently handles two of the three — see the index.

## The seams

The Obsidian API is the widest one, and the plugin sits on more of it than its size suggests:
`vault.getMarkdownFiles`, `getAllFolders`, `getAbstractFileByPath`, `create`, `read`, `modify`,
the `modify`/`delete`/`rename` events, `metadataCache.fileToLinktext`, `normalizePath`, `debounce`
including `Debouncer.cancel`, `Notice`, `PluginSettingTab`, `AbstractInputSuggest`, and the ambient
`window.moment`.

Note that `obsidian` is a **types-only package** — there is no JavaScript in `node_modules/obsidian`.
Nothing in this repository can execute an Obsidian function, which is why the test suite covers
`changelog.ts` completely and `main.ts` and `settings.ts` not at all. That is not a coverage gap
someone forgot to fill; it is the boundary the pure/shell split was drawn to create. The shell is
untested by construction, which is the standing argument for keeping it as thin as it is — and the
reason every change to `main.ts` in 1.6.0 had to be hand-verified in a vault.

`data.json`, written by `saveData` and read by `loadData`, is the persistence seam, and it is
treated as hostile input — see the first invariant.

The release seam is a triple that must move together: the `package.json` version,
the `manifest.json` version, and a `versions.json` entry mapping the new version to the current
`minAppVersion`. `version-bump.ts` writes the latter two from the first, and reads `minAppVersion`
out of the manifest _before_ overwriting the version field, which is the only subtle thing in that
script. `release.yml` triggers on a bare `X.Y.Z` tag and creates the GitHub release itself with
build provenance, so pushing the tag _is_ the publish step; nothing should call `gh release create`.
`CLAUDE.md` directs you to the gate and ship skills rather than tagging by hand.

`deploy.ts` is a local convenience, not part of the pipeline: it copies the three shipped files
into whatever `OBSIDIAN_DEPLOY_DEST` names, from the gitignored `.env.local`.

## Where the theory is thin

**The settings tab has no commit path.** `display()` opens with `const { settings } = this.plugin`
and from then on holds a live reference to the plugin's own state. Every field does the same two
steps — assign into the shared object, then call `saveSettingsSafely()` — at eight separate sites.
There is no single point at which "a setting changed" happens, which is why nothing owns the
invariant that memory matches disk: when the save fails, the assignment has already happened and
no one kept the old value. It is also why validation is per-handler rather than per-field, and why
two of the eight sites have to call `renderExcludedFolders` by hand because there is no change
notification. This is the largest remaining structural weakness and it is scheduled for 1.7.0.

**Validation lives at two boundaries that do not share rules.** Settings arrive from `data.json`
at load and from the tab at edit time. `clampMaxRecentFiles` is the one field where a single rule
serves both, and its doc comment presents that as the pattern — but it was applied to one field of
seven. The loader and the UI therefore disagree, field by field, about what a valid setting is.
Also scheduled for 1.7.0.

**`PathSuggest` serves two fields from one list.** After 1.6.0 that list is folders only, which
removed the sharp edge — you can no longer autocomplete your way onto an existing note. The shared
shape itself remains historical rather than principled: one field wants a folder, the other wants
a path to a file, and they are served by one class because one class was there.

**The suggester's cache is never invalidated.** `cachedPaths` is populated on first use. Because
`display()` rebuilds the tab's DOM and constructs fresh suggesters each time the tab opens, the
cache is effectively per-visit — stale only for files created while the tab sits open. That is a
deliberate trade against per-keystroke vault scanning, not an oversight, but nothing says so.

## Uncertainties

Where I inferred intent from code and could be wrong:

- **`normalizePath`'s empty-string return.** The obsidian package ships no implementation, so I
  could not execute it. The `validateExcludedFolder` finding in the index turns on whether an
  empty input normalizes to `""`, `"."` or `"/"`. The structural complaint holds under any of
  them; the severity does not.
- **`debounce`'s `resetTimer` default.** Same limitation — I read the third parameter and its
  `false` default off the type declaration and Obsidian's published docs, not off a running
  implementation. This matters less than it did: the call site now passes the argument explicitly,
  so it states which semantics it wants rather than inheriting them.
- **Whether the `duplicate` verdict was ever wired up.** The type, the function and the test all
  exist; only the UI arm is missing. I read that as an unfinished intention rather than a decision
  to ignore duplicates silently, but the history does not settle it.
- **What the ownership guard costs.** It adds a `vault.read` of the changelog to every update. The
  trailing-edge debounce landed in the same release and cuts how many updates a burst of editing
  produces, so the two roughly cancel — but I have not measured either on a large vault.
- **What the guard does to an existing user's file on upgrade.** A changelog written by 1.5.x has
  the same line shape and should pass. A user who annotated theirs will hit the refusal on first
  update after upgrading, with only a `Notice` to explain it. Whether that reads as protection or
  as breakage is not something the code can tell me.
- **Coverage.** I read every source file, the tests, both CI workflows, the build and release
  scripts, and `CHANGELOG.md`. I did not run the plugin inside Obsidian, so every claim about
  runtime behavior at the Obsidian seam is inferred from the API declarations.

## Index

Four of the six findings this document previously indexed were closed by milestone 1.6.0:
`changelog-path-may-target-any-existing-note` (#197), `test-files-are-excluded-from-typechecking`
(#214), `readme-names-a-command-the-palette-does-not-show` (#212) and
`debounce-is-called-without-resettimer` (#193). What remains is below; all of it is already filed
and scheduled in milestone 1.7.0.

| #   | Severity | Issue                                                     | Primary location                                   | GitHub |
| --- | -------- | --------------------------------------------------------- | -------------------------------------------------- | ------ |
| 1   | high     | `settings-rules-are-implemented-twice`                    | `src/changelog.ts`, `src/settings.ts`              | #213   |
| 2   | medium   | `settings-tab-mutates-plugin-state-directly`              | `src/settings.ts` — `ChangelogSettingsTab.display` | #215   |
| 3   | medium   | `duplicate-excluded-folder-verdict-is-silently-discarded` | `src/settings.ts` — Add-folder button              | #203   |
| 4   | medium   | `excluded-folder-guard-is-written-for-unnormalized-input` | `src/changelog.ts` — `validateExcludedFolder`      | #204   |

**Total: 4 open issues (0 critical, 1 high, 3 medium, 0 low)** — a partial view; milestone 1.7.0
carries thirteen, and the four above are the ones this theory depends on directly.

This pass filed no new findings. The two tensions it surfaced — the guard's cost, and what it does
to a file a human has annotated — are recorded as uncertainties above rather than as issues,
because neither names something that is wrong so much as something that was decided and should be
watched.
