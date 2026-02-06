# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository. `CLAUDE.md` is a symlink to this file.

## Project Overview

Obsidian plugin that tracks recently edited files in a vault and maintains a chronological changelog. Written in TypeScript, built with Bun.

## Setup & Development

```bash
# Install dependencies (lockfile is frozen via bunfig.toml — won't update bun.lock)
bun install

# Development build with watch mode (outputs to test-vault/.obsidian/plugins/)
bun dev

# Production build (outputs to project root)
bun build

# Lint and format
bun run lint
bun run format
```

Open `test-vault/` in Obsidian to test plugin changes. The dev build watches `src/` and rebuilds automatically.

## Release Process

Releases are tag-triggered. Push a tag to run the GitHub Actions workflow (`.github/workflows/release.yml`), which builds and creates a GitHub release with `main.js`, `manifest.json`, and `styles.css`.

```bash
# Test the workflow locally with act
act push --eventpath <event.json>
```

## Code Architecture

Three source files in `src/`:

- **main.ts** — Plugin class (`ChangelogPlugin`). Registers the "Update Changelog" command, listens to vault events (`modify`, `delete`, `rename`) with 200ms debounce, generates changelog content, and writes it to the configured file. The changelog file is **entirely overwritten** on each update — it is not appended to.
- **settings.ts** — `ChangelogSettings` interface, defaults, and `ChangelogSettingsTab` UI. Validates datetime format via Moment.js before saving; rejects invalid formats with user notification.
- **suggest.ts** — `AbstractInputSuggest` extension providing path autocomplete for the changelog path and excluded folders inputs.

### Key Design Patterns

**Filtering logic** in `getRecentlyEditedFiles()`: excludes the changelog file itself (prevents recursion), excludes files in excluded folders (`startsWith()` path matching), sorts by mtime descending, limits to `maxRecentFiles`.

**File writing**: checks existence with `getAbstractFileByPath()`, then calls `create()` or `modify()` accordingly.

## Build System

Configured in `build.mjs` using Bun's native bundler:

- **Entry point**: `src/main.ts`
- **Output**: CommonJS (required by Obsidian), `obsidian` marked external
- **Dev mode**: outputs to `test-vault/.obsidian/plugins/` with sourcemaps, copies `manifest.json` and `styles.css`
- **Production mode**: outputs to project root, minified, no sourcemaps

## Key Guidelines

- Strict TypeScript (`tsconfig.json` has `strict: true`)
- Access Moment.js via `window.moment` — do not import it; Obsidian provides it globally at runtime
- Use `Plugin.registerEvent()` for vault listeners — Obsidian auto-cleans them on unload
- Use Obsidian CSS custom properties in `styles.css` (`--background-secondary`, `--text-muted`, `--text-error`) — never hardcode colors
- Exclude the changelog file from tracking to prevent recursive updates
- Validate user input in settings before saving
- Use async/await for all async operations
