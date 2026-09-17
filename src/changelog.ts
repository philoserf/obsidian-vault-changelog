export interface ChangelogSettings {
  autoUpdate: boolean;
  changelogPath: string;
  datetimeFormat: string;
  maxRecentFiles: number;
  excludedFolders: string[];
  useWikiLinks: boolean;
  changelogHeading: string;
}

export const DEFAULT_SETTINGS: ChangelogSettings = {
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [],
  useWikiLinks: true,
  changelogHeading: "",
};

export const MAX_RECENT_FILES = 500;

/**
 * The one authoritative clamping rule for maxRecentFiles: floor to an
 * integer and clamp to [1, MAX_RECENT_FILES]; non-finite input falls back
 * to the default. Load-time and the settings UI both call this.
 */
export function clampMaxRecentFiles(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_SETTINGS.maxRecentFiles;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}

/**
 * Turn persisted data into valid settings: drop unknown keys (so renamed
 * or removed settings don't linger), fall back to defaults for known keys
 * whose runtime type doesn't match (guards against hand-edited or corrupt
 * data.json), normalize folder paths so duplicate detection in the
 * settings UI stays consistent, clamp maxRecentFiles, and trim the
 * heading so generateChangelog's "\n\n" spacing stays predictable.
 * `normalize` is injected (Obsidian's normalizePath in production) to
 * keep this module Obsidian-free.
 */
export function normalizeLoadedSettings(
  raw: unknown,
  normalize: (path: string) => string,
): ChangelogSettings {
  const loaded = (raw ?? {}) as Record<string, unknown>;
  const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(loaded)) {
    if (knownKeys.has(key)) {
      filtered[key] = loaded[key];
    }
  }
  const settings: ChangelogSettings = {
    ...DEFAULT_SETTINGS,
    ...(filtered as Partial<ChangelogSettings>),
  };
  for (const key of [
    "changelogPath",
    "changelogHeading",
    "datetimeFormat",
  ] as const) {
    if (typeof settings[key] !== "string")
      settings[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ["autoUpdate", "useWikiLinks"] as const) {
    if (typeof settings[key] !== "boolean")
      settings[key] = DEFAULT_SETTINGS[key];
  }
  if (
    !Array.isArray(settings.excludedFolders) ||
    !settings.excludedFolders.every((folder) => typeof folder === "string")
  ) {
    settings.excludedFolders = DEFAULT_SETTINGS.excludedFolders;
  }
  settings.changelogPath = normalize(settings.changelogPath);
  settings.excludedFolders = settings.excludedFolders.map(normalize);
  settings.maxRecentFiles = clampMaxRecentFiles(settings.maxRecentFiles);
  settings.changelogHeading = settings.changelogHeading.trim();
  return settings;
}

/** The changelog must be a markdown file; paths are validated post-normalize. */
export function isValidChangelogPath(normalizedPath: string): boolean {
  return normalizedPath.endsWith(".md");
}

/** An entry line in the shape generateChangelog emits: "- <time> · <name>". */
const ENTRY_LINE = /^- .+ · .+$/;

/**
 * Does this file look like one this plugin wrote? The plugin replaces the
 * file at changelogPath wholesale, and every note in the vault satisfies the
 * only other check there is (`.md`), so the shell asks this before
 * overwriting and refuses a file that is someone else's note.
 *
 * Deliberately tolerant of a heading it does not recognise: the heading slot
 * accepts whatever is currently there, so changing the changelogHeading
 * setting cannot make the user's own changelog foreign to the plugin that
 * wrote it. What it will not tolerate is prose where entries should be.
 */
export function isPluginGeneratedChangelog(
  content: string,
  changelogHeading: string,
): boolean {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  // Empty: writeToFile's create path lays down "" before the first modify.
  if (lines.length === 0) return true;

  // A heading and nothing else -- a configured heading over an empty vault.
  const heading = changelogHeading.trim();
  if (lines.length === 1 && heading !== "" && lines[0] === heading) return true;

  // Otherwise: entries, optionally under one leading heading line.
  const body = ENTRY_LINE.test(lines[0]) ? lines : lines.slice(1);
  return body.length > 0 && body.every((line) => ENTRY_LINE.test(line));
}

export type ExcludedFolderVerdict = "ok" | "invalid" | "duplicate";

/**
 * Validate a normalized folder path before adding it to excludedFolders:
 * empty input and the vault root are invalid; an already-listed folder is
 * a duplicate.
 */
export function validateExcludedFolder(
  normalizedFolder: string,
  existing: string[],
): ExcludedFolderVerdict {
  if (!normalizedFolder || normalizedFolder === ".") return "invalid";
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}

interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}

export function filterAndSort(
  files: ChangelogFile[],
  changelogPath: string,
  excludedFolders: string[],
  maxRecentFiles: number,
): ChangelogFile[] {
  return files
    .filter((file) => {
      if (file.path === changelogPath) return false;
      for (const folder of excludedFolders) {
        if (file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`))
          return false;
      }
      return true;
    })
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
}

export type TimeFormatter = (mtime: number, format: string) => string;

export function generateChangelog(
  files: ChangelogFile[],
  datetimeFormat: string,
  useWikiLinks: boolean,
  changelogHeading: string,
  formatTime: TimeFormatter,
): string {
  let content = changelogHeading ? `${changelogHeading}\n\n` : "";
  for (const file of files) {
    const time = formatTime(file.stat.mtime, datetimeFormat);
    const name = useWikiLinks ? `[[${file.basename}]]` : file.basename;
    content += `- ${time} · ${name}\n`;
  }
  return content;
}
