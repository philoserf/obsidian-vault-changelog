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

// One rule per setting that has one. Settings arrive across two trust
// boundaries, data.json at load and the settings tab at edit time, and both
// call the same rule (#213). A rule comes in two forms sharing one
// predicate: a coercion for load, which can only fall back to the default,
// and an error message for the tab, which can refuse the edit and keep the
// value the user already has.

/** A count as typed or persisted: numbers and non-blank numeric strings. */
function parseCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/**
 * Load coercion for maxRecentFiles: floor and clamp to [1, MAX_RECENT_FILES].
 * Anything that is not a number or a numeric string falls back to the
 * default. `Number()` alone would turn null, "", [] and false into 0, and
 * then into a changelog one entry long (#209).
 */
export function clampMaxRecentFiles(value: unknown): number {
  const raw = parseCount(value);
  if (!Number.isFinite(raw)) return DEFAULT_SETTINGS.maxRecentFiles;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}

/** Tab rule for maxRecentFiles: a whole number in [1, MAX_RECENT_FILES]. */
export function maxRecentFilesError(value: unknown): string | undefined {
  const raw = parseCount(value);
  if (Number.isInteger(raw) && raw >= 1 && raw <= MAX_RECENT_FILES) return;
  return `Enter a whole number from 1 to ${MAX_RECENT_FILES}`;
}

/** Rule for changelogPath, taken after normalizing: a markdown file. */
export function changelogPathError(normalizedPath: string): string | undefined {
  if (normalizedPath.endsWith(".md")) return;
  return "Changelog path must end with .md";
}

/**
 * Rule for datetimeFormat: not blank. moment's format("") does not fail, it
 * falls through to ISO-8601, so an empty format would silently change every
 * row instead of raising anything.
 */
export function datetimeFormatError(format: string): string | undefined {
  if (format.trim() !== "") return;
  return "Enter a format";
}

export type ExcludedFolderVerdict = "ok" | "invalid" | "duplicate";

/** Every spelling of the vault root that might survive normalization (#204). */
const ROOT_MARKERS = new Set(["", ".", "./", "/"]);

/**
 * Rule for one excluded folder, taken after normalizing: the vault root is
 * invalid, and an already-listed folder is a duplicate.
 */
export function validateExcludedFolder(
  normalizedFolder: string,
  existing: string[],
): ExcludedFolderVerdict {
  if (ROOT_MARKERS.has(normalizedFolder)) return "invalid";
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}

/**
 * Tab rule for one excluded folder, taken after normalizing. `others` are the
 * folders already listed, not counting the one being edited. `exists` asks
 * the vault whether the folder is there: a folder the vault does not have
 * would be a row that looks like a rule and excludes nothing (#205).
 */
export function excludedFolderError(
  normalizedFolder: string,
  others: string[],
  exists: (folder: string) => boolean,
): string | undefined {
  const verdict = validateExcludedFolder(normalizedFolder, others);
  if (verdict === "invalid") return "Choose a folder, not the vault root";
  if (verdict === "duplicate") return "This folder is already excluded";
  if (!exists(normalizedFolder)) return "No folder with this path";
  return;
}

/**
 * Load rule for excludedFolders. A list holding anything but strings is
 * corrupt and falls back whole. Otherwise each entry is normalized and kept
 * only if the Add button would have accepted it against the entries kept so
 * far, which drops roots and collapses ["Archive/", "Archive"] to one row
 * (#211). The result is always a fresh array, never the default's (#266).
 */
function loadExcludedFolders(
  value: unknown,
  normalize: (path: string) => string,
): string[] {
  const folders: string[] = [];
  if (!Array.isArray(value)) return folders;
  if (!value.every((entry) => typeof entry === "string")) return folders;
  for (const entry of value) {
    const folder = normalize(entry);
    if (validateExcludedFolder(folder, folders) === "ok") folders.push(folder);
  }
  return folders;
}

/**
 * Turn persisted data into valid settings, one rule per field. The result
 * is built field by field, never spread from the data, so unknown, renamed
 * and `__proto__` keys cannot reach it, and nothing in it is shared with
 * DEFAULT_SETTINGS (#208). `normalize` is injected (Obsidian's
 * normalizePath in production) to keep this module Obsidian-free.
 */
export function normalizeLoadedSettings(
  raw: unknown,
  normalize: (path: string) => string,
): ChangelogSettings {
  const loaded = (typeof raw === "object" && raw !== null ? raw : {}) as {
    [K in keyof ChangelogSettings]?: unknown;
  };
  const str = (value: unknown): string =>
    typeof value === "string" ? value : "";
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;

  const changelogPath = normalize(str(loaded.changelogPath));
  const datetimeFormat = str(loaded.datetimeFormat);
  return {
    autoUpdate: bool(loaded.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
    changelogPath:
      changelogPathError(changelogPath) === undefined
        ? changelogPath
        : DEFAULT_SETTINGS.changelogPath,
    datetimeFormat:
      datetimeFormatError(datetimeFormat) === undefined
        ? datetimeFormat
        : DEFAULT_SETTINGS.datetimeFormat,
    maxRecentFiles: clampMaxRecentFiles(loaded.maxRecentFiles),
    excludedFolders: loadExcludedFolders(loaded.excludedFolders, normalize),
    useWikiLinks: bool(loaded.useWikiLinks, DEFAULT_SETTINGS.useWikiLinks),
    changelogHeading: (typeof loaded.changelogHeading === "string"
      ? loaded.changelogHeading
      : DEFAULT_SETTINGS.changelogHeading
    ).trim(),
  };
}

/** The three fields the core reads. A real TFile satisfies it, and so does a literal. */
interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}

/**
 * Which files appear, and in what order: never the changelog itself, never
 * anything under an excluded folder, newest first, at most maxRecentFiles.
 * A folder matches only as a whole path segment, so excluding `Notes` does
 * not exclude `Notes2/`.
 */
export function filterAndSort<F extends ChangelogFile>(
  files: F[],
  changelogPath: string,
  excludedFolders: string[],
  maxRecentFiles: number,
): F[] {
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

/**
 * The text a wiki-link should carry for a file. Injected like the time
 * formatter: production asks Obsidian, which gives the bare name when it is
 * unique in the vault and a path when it is not (#202).
 */
export type LinkText<F extends ChangelogFile> = (file: F) => string;

/**
 * The whole changelog for the vault's markdown files, as the settings
 * describe it. This is the one render entry point (#195): it chooses the
 * files and formats them, so no caller can format a list it forgot to
 * filter.
 *
 * Two notes may share a basename. With wiki-links, `linkText` tells them
 * apart. In plain text a row names its note by path when another row has
 * the same basename, and by basename otherwise (#202).
 */
export function renderChangelog<F extends ChangelogFile>(
  files: F[],
  settings: ChangelogSettings,
  formatTime: TimeFormatter,
  linkText: LinkText<F>,
): string {
  const rows = filterAndSort(
    files,
    settings.changelogPath,
    settings.excludedFolders,
    settings.maxRecentFiles,
  );
  const repeated = new Set<string>();
  const seen = new Set<string>();
  for (const file of rows) {
    if (seen.has(file.basename)) repeated.add(file.basename);
    seen.add(file.basename);
  }

  let content = settings.changelogHeading
    ? `${settings.changelogHeading}\n\n`
    : "";
  for (const file of rows) {
    const time = formatTime(file.stat.mtime, settings.datetimeFormat);
    const name = settings.useWikiLinks
      ? `[[${linkText(file)}]]`
      : repeated.has(file.basename)
        ? file.path
        : file.basename;
    content += `- ${time} · ${name}\n`;
  }
  return content;
}
