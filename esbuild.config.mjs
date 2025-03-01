import esbuild from "esbuild";

// CONSIDER: Consider adding TypeScript type checking during build
// CONSIDER: Consider adding banner with version information

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
