import esbuild from "esbuild";

const production = process.argv[2] === "production";

// Define the build options
const buildOptions = {
	bundle: true,
	entryPoints: ["src/main.ts"],
	external: ["obsidian"],
	format: "cjs",
	minify: production,
	outfile: "main.js",
	target: "ESNext",
};

// Build the plugin
esbuild
	.build(buildOptions)
	.then(() => console.log("Build complete!"))
	.catch((err) => {
		console.error("Build failed:", err);
		process.exit(1);
	});
