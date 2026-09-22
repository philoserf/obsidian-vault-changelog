const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error("No version found in package.json");
}

// Update manifest.json
const manifest = await Bun.file("manifest.json").json();
const { minAppVersion } = manifest;
// JSON.stringify drops undefined values, so without this the versions.json
// entry below would vanish silently and the script would still report success.
if (typeof minAppVersion !== "string" || !minAppVersion) {
  throw new Error("No minAppVersion found in manifest.json");
}
manifest.version = targetVersion;
await Bun.write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// Update versions.json
const versions = await Bun.file("versions.json").json();
versions[targetVersion] = minAppVersion;
await Bun.write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Updated to version ${targetVersion}`);

export {};
