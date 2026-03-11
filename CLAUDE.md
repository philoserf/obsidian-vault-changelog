# CLAUDE.md

## Project Overview

Obsidian plugin to maintain a changelog of recently edited notes.

## Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # Run all checks (typecheck + biome)
bun run typecheck        # TypeScript type checking only
bun run lint             # Biome lint + format check
bun run lint:fix         # Auto-fix lint and format issues
bun run format           # Format code with Biome
bun run validate         # Full validation (types, checks, build, output)
bun run version          # Sync package.json version to manifest.json + versions.json
bun test                 # Run tests
```

## Architecture

### Build System

- **Build script**: `build.ts` uses Bun's native bundler
- **Entry point**: `src/main.ts`
- **Output**: `./main.js` (CommonJS format, minified in production)
- **Externals**: `obsidian` and `electron` are not bundled

### Release Process

Tag and push to trigger the GitHub Actions release workflow:

```bash
git tag -a 1.0.0 -m "Release 1.0.0"
git push origin 1.0.0
```

## Code Style

Enforced by Biome: 2-space indent, organized imports, git-aware VCS integration.
