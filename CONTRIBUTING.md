# Contributing

This plugin is in the community directory and has outside users. Outside a planned major release
it is in maintenance mode (#252): no change unless a user asks for it.

## Gates

Every change runs the same gates locally and in CI:

```bash
bun run build                 # typecheck + Biome, then bundle
bun test
git diff --exit-code main.js  # the committed bundle is what ships
```

`main.ts` and `settings.ts` cannot run outside Obsidian, so behavior there is proven by the beta
checklist below, run in a real vault.

Before a release tag, run the community site's lint rules locally and expect zero warnings. Run
them from a scratch directory so ESLint never enters this repository, which is Biome-only:
`eslint-plugin-obsidianmd` (`obsidianmd/eslint-plugin`).

## Betas

A beta is a GitHub prerelease cut from the release branch by the **Beta** workflow
(`.github/workflows/beta.yml`). Run it with a version such as `2.0.0-beta.1`. The version is
written into `manifest.json` for that run only. Install the prerelease with BRAT in a scratch
vault.

A beta passes when **every** item below passes on that one beta. Any later change to `src/` or to
dependencies needs a new beta and a full re-run. A change that touches only docs does not.

### Checklist

#### Ownership of the changelog file

- [ ] Empty vault, then change the heading: the changelog is still written.
- [ ] A note of your own whose bullets contain `·` placed at the changelog path is refused, with
      one Notice per session, and left untouched.
- [ ] Upgrade from 1.8.0: the existing changelog is adopted and gets the marker on its next write.
- [ ] Upgrade from 1.8.0 with the old changelog at a different path than the setting: it is not
      adopted.
- [ ] An empty existing note at the path is accepted.
- [ ] Rename another note onto the changelog path: the next write is refused.
- [ ] Change the path away from an existing changelog: a Notice says the old file is now an
      ordinary note, and it is not deleted.

#### Upgrade from 1.8.0 settings

- [ ] Fresh install.
- [ ] `data.json` with defaults only.
- [ ] `data.json` with every field set.
- [ ] Corrupt `data.json`: `maxRecentFiles: null`, `datetimeFormat: ""`, `changelogPath: "Notes"`,
      `excludedFolders: ["Archive/", "Archive"]`, plus an unknown key. Each loads to its
      documented value and shows correctly in the settings tab.
- [ ] Obsidian older than the new `minAppVersion` still resolves to 1.8.0 (`versions.json`).

#### Settings edits

- [ ] Type quickly in the datetime format and heading fields, then reload: the last edit is on
      disk and in memory.
- [ ] Toggle a setting twice quickly: the final state is the one saved.
- [ ] Make `data.json` read-only and edit two fields: nothing claims to be saved that is not.
- [ ] Clear the datetime format field: an inline error shows, nothing is saved, and the preview
      shows the default.
- [ ] Max recent files: `0`, `501`, `2.5` and text are refused with an inline error.
- [ ] With auto-update on, change each output-shaping setting: the changelog updates once.

#### Sync

- [ ] Change a setting on one device: the other picks it up without a restart and without saving.
- [ ] Change a setting on both devices while a save is in flight.

#### Rename and move

- [ ] Rename the changelog: no ghost file at the old path, and the changelog does not list itself.
- [ ] Move the changelog to another folder, then move its folder, then undo.

#### Rendering

- [ ] Output matches the 1.8.0 fixtures except where basenames collide.
- [ ] Two notes with the same filename: distinct rows, with wiki-links on and off.

#### Write discipline

- [ ] Edit an image, a note in an excluded folder, and the top note twice inside one minute: the
      changelog's modified time does not change.
- [ ] Type steadily in a note: the changelog is written once after typing stops.

#### Errors

- [ ] Point the changelog path into a folder that does not exist, then run the update: either the
      changelog is created, or a Notice gives the reason, and the developer console logs the
      error with its cause.
- [ ] Point the changelog path at a folder named like a note (`Folder.md/`): the Notice says it
      is a folder.

#### Lifecycle

- [ ] Disable the plugin within 200 ms of an edit: no write afterwards.
- [ ] Update the plugin in place: two instances never both write.

#### Excluded folders

- [ ] Add, delete, a duplicate, a folder that does not exist, and the vault root.

#### Mobile

- [ ] One full pass on iOS.

### Run log

One line per beta: date, version, device, and pass or the failing items.

| Date | Version | Device | Result |
| ---- | ------- | ------ | ------ |
