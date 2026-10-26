import { $ } from "bun";

const dest = process.env.OBSIDIAN_DEPLOY_DEST;
if (!dest) {
  console.error("OBSIDIAN_DEPLOY_DEST not set — see .env.local");
  process.exit(1);
}

await $`mkdir -p ${dest}`;
await $`cp main.js manifest.json ${dest}`;
