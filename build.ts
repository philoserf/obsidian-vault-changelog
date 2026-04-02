import { watch } from "node:fs";

const isWatch = process.argv.includes("--watch");

async function build(): Promise<boolean> {
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: ".",
    format: "cjs",
    external: ["obsidian", "electron"],
    minify: !isWatch,
  });

  if (!result.success) {
    console.error("Build failed");
    for (const message of result.logs) console.error(message);
    return false;
  }
  return true;
}

const ok = await build();
if (!ok && !isWatch) process.exit(1);

if (isWatch) {
  console.log("Watching src/ for changes...");
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch("src", { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      console.log("Rebuilding...");
      await build();
    }, 100);
  });
}
