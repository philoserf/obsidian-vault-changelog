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
 * integer and clamp to [1, MAX_RECENT_FILES]; anything that is not a number
 * falls back. Load-time and the settings UI both call this.
 *
 * `fallback` is what a value that is not a number at all becomes. The loader
 * omits it and gets the default, because at load there is no prior value; the
 * settings tab passes the value the plugin is currently running on, so a typo
 * reverts rather than resetting the setting. Note this is the *non-numeric*
 * path only -- an out-of-range number still clamps, which is why 0 becomes 1
 * and 1000 becomes 500 at both boundaries.
 *
 * Non-numbers are rejected *before* coercion rather than after. `Number()`
 * maps null, "", "   ", [] and false to a perfectly finite 0, which the clamp
 * below would then raise to 1 -- turning a corrupt data.json into a changelog
 * one entry long, which reads as "the plugin broke" rather than as a settings
 * problem. Numeric strings stay accepted because the settings tab hands this
 * function the raw contents of a text field.
 */
export function clampMaxRecentFiles(
  value: unknown,
  fallback: number = DEFAULT_SETTINGS.maxRecentFiles,
): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}

/**
 * Authoritative rule for changelogPath: the changelog must be a markdown
 * file. Both boundaries call this, which is the whole point -- the settings
 * tab has refused a non-`.md` path since #142, and the loader never has, so
 * a persisted `"Notes"` was a value the plugin ran on and the settings tab
 * would not display.
 *
 * `fallback` is the settings tab's current value and the loader's default,
 * so a typo in the field reverts to what the user had rather than resetting
 * the setting to `Changelog.md`.
 */
export function coerceChangelogPath(
  value: unknown,
  normalize: (path: string) => string,
  fallback: string = DEFAULT_SETTINGS.changelogPath,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = normalize(value);
  return normalized.endsWith(".md") ? normalized : fallback;
}

/**
 * Authoritative rule for datetimeFormat: an empty format is not a format.
 * The failure it prevents is silent rather than loud -- moment's `format("")`
 * falls through to ISO-8601, so an empty persisted format turns every row
 * into a full timestamp instead of raising anything.
 *
 * This is the one rule the settings tab calls *without* passing its current
 * value. Clearing the field and blurring is the only reset-to-default the
 * field offers, and it has always landed on the default; handing it the
 * current value would quietly take that away.
 */
export function coerceDatetimeFormat(
  value: unknown,
  fallback: string = DEFAULT_SETTINGS.datetimeFormat,
): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/**
 * Authoritative rule for excludedFolders: normalize each entry, then put it
 * through the same verdict the Add button uses. Root markers and duplicates
 * both fall out of that one pass, because the verdict is taken against the
 * accumulating result rather than against the input -- which is what makes
 * `["Archive/", "Archive"]` collapse to one row instead of two identical
 * ones whose remove buttons both delete the first.
 *
 * An array carrying a non-string is corrupt rather than partly usable, so
 * the whole field falls back. That is the all-or-nothing rule the scalar
 * guards apply, and the suite pins it.
 */
export function coerceExcludedFolders(
  value: unknown,
  normalize: (path: string) => string,
  fallback: string[] = DEFAULT_SETTINGS.excludedFolders,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((folder) => typeof folder === "string")
  ) {
    return [...fallback];
  }
  const folders: string[] = [];
  for (const entry of value as string[]) {
    const folder = normalize(entry);
    if (validateExcludedFolder(folder, folders) === "ok") folders.push(folder);
  }
  return folders;
}

/**
 * Turn persisted data into valid settings: one rule call per field. Disk is
 * one of the two trust boundaries and the settings tab is the other, and
 * every rule above is called by both -- which is the property this function
 * exists to hold up. It passes no `fallback` anywhere, because at load there
 * is no prior value to revert to; the settings tab passes one.
 *
 * The two fields with no rule to share are the booleans, which a typed toggle
 * cannot get wrong, and the heading, whose whole rule is `.trim()`.
 * `normalize` is injected (Obsidian's normalizePath in production) to keep
 * this module Obsidian-free.
 *
 * Unknown keys cannot survive, and no filter is needed to stop them: the
 * result is *built* rather than patched, so nothing from `loaded` is spread
 * into it and every field arrives by name. That also makes the object immune
 * to a `__proto__` key in the persisted JSON, which is a property of the
 * construction rather than of a guard someone could delete.
 */
export function normalizeLoadedSettings(
  raw: unknown,
  normalize: (path: string) => string,
): ChangelogSettings {
  const loaded = (raw ?? {}) as Partial<
    Record<keyof ChangelogSettings, unknown>
  >;

  const str = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;

  return {
    autoUpdate: bool(loaded.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
    changelogPath: coerceChangelogPath(loaded.changelogPath, normalize),
    datetimeFormat: coerceDatetimeFormat(loaded.datetimeFormat),
    maxRecentFiles: clampMaxRecentFiles(loaded.maxRecentFiles),
    excludedFolders: coerceExcludedFolders(loaded.excludedFolders, normalize),
    useWikiLinks: bool(loaded.useWikiLinks, DEFAULT_SETTINGS.useWikiLinks),
    changelogHeading: str(
      loaded.changelogHeading,
      DEFAULT_SETTINGS.changelogHeading,
    ).trim(),
  };
}

/** An entry line in the shape renderChangelog emits: "- <time> · <name>". */
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

  // Empty: updateChangelog's create path lays down "" before the first modify.
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
 * Every shape a normalizer can hand back for "no folder at all". The guard
 * below is reached only with already-normalized input, and Obsidian's
 * normalizePath maps an empty or separator-only string onto one of these
 * rather than onto "" -- which of them is version-dependent, so the set
 * covers all four instead of betting on one. A root marker that survives
 * into excludedFolders is not corrupting, just permanently inert:
 * filterAndSort would test `path.startsWith("./")`, and no vault path
 * begins that way, so the row excludes nothing and never stops doing so.
 */
const ROOT_MARKERS = new Set(["", ".", "./", "/"]);

/**
 * Validate a normalized folder path before adding it to excludedFolders:
 * the vault root in any of its spellings is invalid; an already-listed
 * folder is a duplicate.
 */
export function validateExcludedFolder(
  normalizedFolder: string,
  existing: string[],
): ExcludedFolderVerdict {
  if (ROOT_MARKERS.has(normalizedFolder.trim())) return "invalid";
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}

export interface ChangelogFile {
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

/**
 * How a file is named in the changelog. Injected, like TimeFormatter, so this
 * module stays Obsidian-free: production passes MetadataCache.fileToLinktext,
 * which uses the bare filename when it is unique in the vault and the full
 * path when it is not.
 */
export type LinkTextResolver = (file: ChangelogFile) => string;

/**
 * The module's one render entry point: filter, sort and format, taking the
 * settings it renders from rather than six of their fields spelled out
 * positionally. Adding a setting that affects output no longer means widening
 * a signature and a call site that carry no information of their own.
 */
export function renderChangelog(
  files: ChangelogFile[],
  settings: ChangelogSettings,
  formatTime: TimeFormatter,
  resolveLinkText: LinkTextResolver,
): string {
  const recent = filterAndSort(
    files,
    settings.changelogPath,
    settings.excludedFolders,
    settings.maxRecentFiles,
  );
  let content = settings.changelogHeading
    ? `${settings.changelogHeading}\n\n`
    : "";
  for (const file of recent) {
    const time = formatTime(file.stat.mtime, settings.datetimeFormat);
    // Resolved for both modes: a bare basename is ambiguous in plain text for
    // exactly the same reason it is ambiguous as a wiki-link.
    const name = resolveLinkText(file);
    content += `- ${time} · ${settings.useWikiLinks ? `[[${name}]]` : name}\n`;
  }
  return content;
}
