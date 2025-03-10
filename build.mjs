import { join } from "path";
import { build, file, write } from "bun";
import { mkdir } from "node:fs/promises";

const production = process.argv[2] === "production";

// Setup output paths
const outDir = production
	? "."
	: "test-vault/.obsidian/plugins/obsidian-vault-changelog";

// Ensure the directory exists
await mkdir(outDir, { recursive: true });

// Copy manifest.json and styles.css to output directory in dev mode
if (!production) {
	await write(
		join(outDir, "manifest.json"),
		await file("manifest.json").text(),
	);
	await write(join(outDir, "styles.css"), await file("styles.css").text());
}

const buildOptions = {
	entrypoints: ["./src/main.ts"],
	outdir: outDir,
	outfile: join(outDir, "main.js"),
	format: "cjs",
	external: ["obsidian"],
	target: "browser",
	minify: production,
	sourcemap: production ? "none" : "external",
};

async function runBuild() {
	const result = await build(buildOptions);

	if (!result.success) {
		console.error("Build failed:", result.logs);
		process.exit(1);
	}

	if (production) {
		console.log("Production build completed");
		process.exit(0);
	} else {
		console.log("Development build completed. Watching for changes...");

		// Use Node's fs.watch for file changes
		const { watch } = await import("node:fs");
		watch("./src", { recursive: true }, async (eventType, filename) => {
			console.log(`File ${filename} changed, rebuilding...`);
			await build(buildOptions);
		});
	}
}

runBuild();
