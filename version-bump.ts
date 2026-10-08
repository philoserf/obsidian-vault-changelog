import { env, file, write } from "bun";

const targetVersion = env.npm_package_version;
if (!targetVersion) {
  throw new Error("No version found in package.json");
}

// Update manifest.json
const manifest = (await file("manifest.json").json()) as {
  version?: unknown;
  minAppVersion?: unknown;
};
const { minAppVersion } = manifest;
// JSON.stringify drops undefined values, so without this the versions.json
// entry below would vanish silently and the script would still report success.
if (typeof minAppVersion !== "string" || !minAppVersion) {
  throw new Error("No minAppVersion found in manifest.json");
}
manifest.version = targetVersion;
await write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// Update versions.json
const versions = (await file("versions.json").json()) as Record<string, string>;
versions[targetVersion] = minAppVersion;
await write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
