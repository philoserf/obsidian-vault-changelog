#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { $ } from "bun";

const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
console.log(`🔍 Validating ${manifest.name || "plugin"}...\n`);

let errors = 0;

// Check manifest.json
if (!manifest.id || !manifest.name || !manifest.version) {
  console.error("✗ manifest.json missing required fields");
  errors++;
} else {
  console.log(`✓ manifest.json — ${manifest.name} v${manifest.version}`);
}

// Check package.json version matches manifest
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  if (pkg.version !== manifest.version) {
    console.error(
      `✗ Version mismatch: package.json (${pkg.version}) != manifest.json (${manifest.version})`,
    );
    errors++;
  } else {
    console.log("✓ Version numbers match");
  }
} catch (error) {
  console.error("✗ Version check failed:", error);
  errors++;
}

// Run checks
console.log("\n🔧 Checking code quality...");
const checkResult = await $`bun run check`.nothrow();
if (checkResult.exitCode === 0) {
  console.log("✓ Code quality checks passed");
} else {
  console.error("✗ Code quality checks failed");
  errors++;
}

// Build the plugin
console.log("\n📦 Building plugin...");
const buildResult = await $`bun run build.ts`.nothrow();
if (buildResult.exitCode === 0) {
  console.log("✓ Build successful");

  const mainFile = Bun.file("main.js");
  if (await mainFile.exists()) {
    const size = mainFile.size / 1024;
    console.log(`  Output: main.js (${size.toFixed(2)} KB)`);
  } else {
    console.error("✗ main.js not found after build");
    errors++;
  }
} else {
  console.error("✗ Build failed");
  errors++;
}

// Summary
console.log(`\n${"=".repeat(50)}`);
if (errors === 0) {
  console.log("✅ All validations passed! Plugin is ready.");
  process.exit(0);
} else {
  console.log(`❌ Validation failed with ${errors} error(s).`);
  process.exit(1);
}
