const isWatch = process.argv.includes("--watch");

async function build() {
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: ".",
    format: "cjs",
    external: ["obsidian", "electron"],
    minify: !isWatch,
    sourcemap: isWatch ? "linked" : "none",
  });

  if (!result.success) {
    console.error("Build failed");
    for (const message of result.logs) console.error(message);
    if (!isWatch) process.exit(1);
    return;
  }

  console.log(
    `Built main.js (${(result.outputs[0].size / 1024).toFixed(1)} KB)`,
  );
}

await build();

if (isWatch) {
  console.log("Watching src/ for changes...");
  const { watch } = await import("node:fs");
  let timeout: ReturnType<typeof setTimeout> | null = null;

  watch("src", { recursive: true }, (_event, filename) => {
    if (!filename?.endsWith(".ts")) return;
    if (filename.includes(".test.")) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(async () => {
      console.log(`\nRebuilding (${filename} changed)...`);
      await build();
    }, 100);
  });
}

export {};
