# Contributing

💡 Want to improve the plugin? Here's how you can help:

- **Discussions**: [GitHub Discussions](https://github.com/philoserf/obsidian-vault-changelog/discussions)
- **Bug Reports**: [Open an Issue](https://github.com/philoserf/obsidian-vault-changelog/issues)
- **Feature Requests**: [Open a Pull Request](https://github.com/philoserf/obsidian-vault-changelog/pulls)
- **Community**: [Obsidian Forum](https://forum.obsidian.md) | [Obsidian Discord](https://discord.gg/obsidianmd)

## Development

This project uses Bun as the build tool:

1. Clone this repository `gh repo clone philoserf/obsidian-vault-changelog`.
2. Install Bun: [https://bun.sh/docs/installation](https://bun.sh/docs/installation)
3. Install dependencies: `bun install`
4. Format: `bun run format`
5. Lint: `bun run lint`
6. Development build with auto-refresh: `bun run dev`
7. Production build: `bun run build`

### Using the test-vault

The project includes a test-vault for development:

1. Open the test-vault in Obsidian (`File > Open another vault > Open folder as vault` and select the `test-vault` directory)
2. Build the plugin with hot-reload: `bun run dev`
3. Changes will automatically be applied to the plugin in the test-vault

### Manual installation

Alternatively, you can manually install the plugin in your own vault:

1. Copy `manifest.json` and `main.js` into your **Obsidian plugins folder** (`.obsidian/plugins/obsidian-vault-changelog`).
2. Reload Obsidian and enable the plugin.

## Test release

```shell
act \
    --container-architecture linux/amd64 \
    -W .github/workflows/release.yml \
    -P ubuntu-latest=catthehacker/ubuntu:act-latest \
    --pull=false \
    -e <(echo '{"ref": "refs/tags/v1.0.0", "ref_name": "v1.0.0"}')
```
