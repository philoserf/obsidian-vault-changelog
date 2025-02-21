import esbuild from "esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2018",
	outfile: "main.js",
	sourcemap: !production,
	minify: production,
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
