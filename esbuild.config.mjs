import esbuild from "esbuild";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const production = process.argv[2] === "production";

// Setup output paths
const outDir = production
	? "."
	: "test-vault/.obsidian/plugins/obsidian-vault-changelog";
// Ensure the directory exists
if (!existsSync(outDir)) {
	mkdirSync(outDir, { recursive: true });
}

// Copy manifest.json and styles.css to output directory in dev mode
if (!production) {
	const { copyFileSync } = await import("fs");
	copyFileSync("manifest.json", join(outDir, "manifest.json"));
	copyFileSync("styles.css", join(outDir, "styles.css"));
}

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2018",
	outfile: join(outDir, "main.js"),
	sourcemap: !production,
	minify: production,
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
