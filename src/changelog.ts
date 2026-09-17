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
 * falls back to the default. Load-time and the settings UI both call this.
 *
 * Non-numbers are rejected *before* coercion rather than after. `Number()`
 * maps null, "", "   ", [] and false to a perfectly finite 0, which the clamp
 * below would then raise to 1 -- turning a corrupt data.json into a changelog
 * one entry long, which reads as "the plugin broke" rather than as a settings
 * problem. Numeric strings stay accepted because the settings tab hands this
 * function the raw contents of a text field.
 */
export function clampMaxRecentFiles(value: unknown): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(raw)) return DEFAULT_SETTINGS.maxRecentFiles;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}

/**
 * Turn persisted data into valid settings: one expression per field, each
 * reading its persisted value by name and falling back to the default when
 * the runtime type doesn't match (which is what guards against a hand-edited
 * or corrupt data.json). Paths are normalized so duplicate detection in the
 * settings UI stays consistent, maxRecentFiles is clamped, and the heading is
 * trimmed so renderChangelog's "\n\n" spacing stays predictable. `normalize`
 * is injected (Obsidian's normalizePath in production) to keep this module
 * Obsidian-free.
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

  // An array carrying a non-string is corrupt rather than partly usable, so
  // the whole field falls back -- the same all-or-nothing rule the scalar
  // guards apply. Mapping afterwards also means the default array is copied
  // rather than aliased, which matters because the settings UI mutates this
  // field in place.
  const folders =
    Array.isArray(loaded.excludedFolders) &&
    loaded.excludedFolders.every((folder) => typeof folder === "string")
      ? (loaded.excludedFolders as string[])
      : DEFAULT_SETTINGS.excludedFolders;

  return {
    autoUpdate: bool(loaded.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
    changelogPath: normalize(
      str(loaded.changelogPath, DEFAULT_SETTINGS.changelogPath),
    ),
    datetimeFormat: str(loaded.datetimeFormat, DEFAULT_SETTINGS.datetimeFormat),
    maxRecentFiles: clampMaxRecentFiles(loaded.maxRecentFiles),
    excludedFolders: folders.map(normalize),
    useWikiLinks: bool(loaded.useWikiLinks, DEFAULT_SETTINGS.useWikiLinks),
    changelogHeading: str(
      loaded.changelogHeading,
      DEFAULT_SETTINGS.changelogHeading,
    ).trim(),
  };
}

/** The changelog must be a markdown file; paths are validated post-normalize. */
export function isValidChangelogPath(normalizedPath: string): boolean {
  return normalizedPath.endsWith(".md");
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
