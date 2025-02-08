import { readFileSync, writeFileSync } from "fs";

function readJSON(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new Error(`Couldn't read or parse ${file}`);
	}
}

function writeJSON(file, data) {
	writeFileSync(file, JSON.stringify(data, null, 2));
}

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	throw new Error("Package version not found in environment.");
}

const manifest = readJSON("manifest.json");
manifest.version = targetVersion;
writeJSON("manifest.json", manifest);

const versions = readJSON("versions.json");
versions[targetVersion] = manifest.minAppVersion;
writeJSON("versions.json", versions);
