import { describe, expect, test } from "bun:test";
import moment from "moment";

import {
  clampMaxRecentFiles,
  coerceChangelogPath,
  coerceDatetimeFormat,
  coerceExcludedFolders,
  DEFAULT_SETTINGS,
  filterAndSort,
  isPluginGeneratedChangelog,
  normalizeLoadedSettings,
  renderChangelog,
  validateExcludedFolder,
} from "./changelog";

const formatter = (mtime: number, fmt: string) => moment(mtime).format(fmt);

/** Stands in for fileToLinktext in the common case: the basename is unique. */
const byBasename = (file: { basename: string }) => file.basename;

describe("filterAndSort", () => {
  const files = [
    { path: "Note A.md", basename: "Note A", stat: { mtime: 100 } },
    { path: "Note B.md", basename: "Note B", stat: { mtime: 300 } },
    { path: "Note C.md", basename: "Note C", stat: { mtime: 200 } },
    { path: "Changelog.md", basename: "Changelog", stat: { mtime: 400 } },
    {
      path: "Archive/Old Note.md",
      basename: "Old Note",
      stat: { mtime: 500 },
    },
  ];

  test("excludes the changelog file", () => {
    const result = filterAndSort(files, "Changelog.md", [], 25);
    expect(result.find((f) => f.path === "Changelog.md")).toBeUndefined();
  });

  test("excludes files in excluded folders", () => {
    const result = filterAndSort(files, "Changelog.md", ["Archive/"], 25);
    expect(result.find((f) => f.path.startsWith("Archive/"))).toBeUndefined();
  });

  test("excludes folders saved without trailing slash", () => {
    // normalizePath strips trailing slashes, so "Archive" is the shape
    // the settings layer actually persists.
    const result = filterAndSort(files, "Changelog.md", ["Archive"], 25);
    expect(result.find((f) => f.path.startsWith("Archive/"))).toBeUndefined();
  });

  test("sorts by mtime descending", () => {
    const result = filterAndSort(files, "Changelog.md", ["Archive/"], 25);
    expect(result.map((f) => f.basename)).toEqual([
      "Note B",
      "Note C",
      "Note A",
    ]);
  });

  test("limits to maxRecentFiles", () => {
    const result = filterAndSort(files, "Changelog.md", [], 2);
    expect(result).toHaveLength(2);
  });

  test("returns all files when maxRecentFiles exceeds file count", () => {
    const result = filterAndSort(files, "Changelog.md", [], 1000);
    expect(result).toHaveLength(4);
  });

  test("does not exclude folders that share a prefix", () => {
    const filesWithPrefix = [
      { path: "Notes/file.md", basename: "file", stat: { mtime: 100 } },
      { path: "Notes2/file.md", basename: "file2", stat: { mtime: 200 } },
      { path: "Notebook/file.md", basename: "file3", stat: { mtime: 300 } },
    ];
    const result = filterAndSort(
      filesWithPrefix,
      "Changelog.md",
      ["Notes"],
      25,
    );
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual([
      "Notebook/file.md",
      "Notes2/file.md",
    ]);
  });
});

describe("renderChangelog", () => {
  const files = [
    {
      path: "Note B.md",
      basename: "Note B",
      stat: { mtime: new Date("2026-01-15T14:30:00").getTime() },
    },
    {
      path: "Note A.md",
      basename: "Note A",
      stat: { mtime: new Date("2026-01-15T14:00:00").getTime() },
    },
  ];

  test("generates changelog without heading", () => {
    const result = renderChangelog(
      files,
      DEFAULT_SETTINGS,
      formatter,
      byBasename,
    );
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 [[Note B]]\n- 2026-01-15T1400 \u00b7 [[Note A]]\n",
    );
  });

  test("generates changelog without wiki-links", () => {
    const result = renderChangelog(
      files,
      { ...DEFAULT_SETTINGS, useWikiLinks: false },
      formatter,
      byBasename,
    );
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 Note B\n- 2026-01-15T1400 \u00b7 Note A\n",
    );
  });

  test("generates changelog with heading", () => {
    const result = renderChangelog(
      files,
      { ...DEFAULT_SETTINGS, changelogHeading: "# Changelog" },
      formatter,
      byBasename,
    );
    expect(result).toStartWith("# Changelog\n\n");
  });

  test("generates empty changelog", () => {
    const result = renderChangelog([], DEFAULT_SETTINGS, formatter, byBasename);
    expect(result).toBe("");
  });

  test("distinguishes two notes that share a basename", () => {
    // fileToLinktext falls back to the full path when the filename is not
    // unique; a bare basename would emit two identical rows whose wiki-links
    // both resolve to whichever note the vault picks.
    const duplicates = [
      {
        path: "Projects/Meeting Notes.md",
        basename: "Meeting Notes",
        stat: { mtime: new Date("2026-01-15T14:30:00").getTime() },
      },
      {
        path: "Archive/Meeting Notes.md",
        basename: "Meeting Notes",
        stat: { mtime: new Date("2026-01-15T14:00:00").getTime() },
      },
    ];
    const result = renderChangelog(
      duplicates,
      DEFAULT_SETTINGS,
      formatter,
      (file) => file.path.replace(/\.md$/, ""),
    );
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 [[Projects/Meeting Notes]]\n" +
        "- 2026-01-15T1400 \u00b7 [[Archive/Meeting Notes]]\n",
    );
  });
});

describe("clampMaxRecentFiles", () => {
  test("returns a valid in-range integer as-is", () => {
    expect(clampMaxRecentFiles(25)).toBe(25);
    expect(clampMaxRecentFiles(1)).toBe(1);
    expect(clampMaxRecentFiles(500)).toBe(500);
  });

  test("floors floats", () => {
    expect(clampMaxRecentFiles(25.9)).toBe(25);
  });

  test("clamps below 1 to 1", () => {
    expect(clampMaxRecentFiles(0)).toBe(1);
    expect(clampMaxRecentFiles(-5)).toBe(1);
    expect(clampMaxRecentFiles(0.4)).toBe(1);
  });

  test("clamps above the maximum", () => {
    expect(clampMaxRecentFiles(1000)).toBe(500);
  });

  test("accepts numeric strings", () => {
    expect(clampMaxRecentFiles("42")).toBe(42);
  });

  test("falls back to the default for non-finite input", () => {
    expect(clampMaxRecentFiles(Number.NaN)).toBe(25);
    expect(clampMaxRecentFiles("abc")).toBe(25);
    expect(clampMaxRecentFiles(Number.POSITIVE_INFINITY)).toBe(25);
    expect(clampMaxRecentFiles(undefined)).toBe(25);
  });

  // Number() maps every one of these to a finite 0, which the clamp would
  // raise to 1. They are the shapes a hand-edited or partially-written
  // data.json actually produces, and 1 is the answer that looks like a bug.
  // The settings tab passes its current value here; the loader omits it.
  // Only the non-numeric path uses it -- an out-of-range *number* still
  // clamps, which is why 0 becomes 1 rather than reverting.
  test("uses the supplied fallback instead of the default", () => {
    expect(clampMaxRecentFiles("abc", 40)).toBe(40);
    expect(clampMaxRecentFiles(null, 40)).toBe(40);
    expect(clampMaxRecentFiles(0, 40)).toBe(1);
    expect(clampMaxRecentFiles(1000, 40)).toBe(500);
  });

  test("falls back to the default for non-numeric input Number() would coerce", () => {
    expect(clampMaxRecentFiles(null)).toBe(25);
    expect(clampMaxRecentFiles("")).toBe(25);
    expect(clampMaxRecentFiles("   ")).toBe(25);
    expect(clampMaxRecentFiles([])).toBe(25);
    expect(clampMaxRecentFiles(false)).toBe(25);
    expect(clampMaxRecentFiles(true)).toBe(25);
    expect(clampMaxRecentFiles({})).toBe(25);
  });
});

describe("normalizeLoadedSettings", () => {
  const identity = (p: string) => p;

  test("returns defaults for null/undefined data", () => {
    expect(normalizeLoadedSettings(null, identity)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeLoadedSettings(undefined, identity)).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  test("drops unknown keys", () => {
    const settings = normalizeLoadedSettings(
      { autoUpdate: true, legacySetting: "stale" },
      identity,
    );
    expect(settings.autoUpdate).toBe(true);
    expect("legacySetting" in settings).toBe(false);
  });

  test("normalizes changelogPath and excludedFolders", () => {
    const stripTrailing = (p: string) => p.replace(/\/+$/, "");
    const settings = normalizeLoadedSettings(
      {
        changelogPath: "Notes/Changelog.md/",
        excludedFolders: ["Archive/", "Templates/"],
      },
      stripTrailing,
    );
    expect(settings.changelogPath).toBe("Notes/Changelog.md");
    expect(settings.excludedFolders).toEqual(["Archive", "Templates"]);
  });

  test("clamps invalid maxRecentFiles", () => {
    expect(
      normalizeLoadedSettings({ maxRecentFiles: Number.NaN }, identity)
        .maxRecentFiles,
    ).toBe(25);
    expect(
      normalizeLoadedSettings({ maxRecentFiles: -3 }, identity).maxRecentFiles,
    ).toBe(1);
    expect(
      normalizeLoadedSettings({ maxRecentFiles: 9999 }, identity)
        .maxRecentFiles,
    ).toBe(500);
  });

  test("falls back to the default for a maxRecentFiles Number() would coerce", () => {
    for (const bad of [null, "", [], false]) {
      const result = normalizeLoadedSettings({ maxRecentFiles: bad }, identity);
      expect(result.maxRecentFiles).toBe(DEFAULT_SETTINGS.maxRecentFiles);
    }
  });

  // The three load/UI divergences #213 names. Each of these persisted values
  // survived load untouched before, while the settings tab refused it.
  test("applies the changelog-path rule at load", () => {
    expect(
      normalizeLoadedSettings({ changelogPath: "Notes" }, identity)
        .changelogPath,
    ).toBe(DEFAULT_SETTINGS.changelogPath);
  });

  test("applies the datetime-format rule at load", () => {
    expect(
      normalizeLoadedSettings({ datetimeFormat: "" }, identity).datetimeFormat,
    ).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });

  test("applies the excluded-folder rule at load", () => {
    const stripTrailing = (p: string) => p.replace(/\/+$/, "");
    expect(
      normalizeLoadedSettings({ excludedFolders: ["."] }, identity)
        .excludedFolders,
    ).toEqual([]);
    expect(
      normalizeLoadedSettings(
        { excludedFolders: ["Archive/", "Archive"] },
        stripTrailing,
      ).excludedFolders,
    ).toEqual(["Archive"]);
  });

  test("trims the changelog heading", () => {
    const settings = normalizeLoadedSettings(
      { changelogHeading: "  # Changelog \n" },
      identity,
    );
    expect(settings.changelogHeading).toBe("# Changelog");
  });

  test("falls back to defaults when known keys have the wrong type", () => {
    const settings = normalizeLoadedSettings(
      {
        changelogPath: 42,
        excludedFolders: null,
        changelogHeading: 42,
        datetimeFormat: 42,
      },
      identity,
    );
    expect(settings.changelogPath).toBe(DEFAULT_SETTINGS.changelogPath);
    expect(settings.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
    expect(settings.changelogHeading).toBe(DEFAULT_SETTINGS.changelogHeading);
    expect(settings.datetimeFormat).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });

  test("falls back for excludedFolders when it contains non-string entries", () => {
    const settings = normalizeLoadedSettings(
      { excludedFolders: ["Archive/", 42] },
      identity,
    );
    expect(settings.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
  });

  test("falls back to defaults when boolean keys have the wrong type", () => {
    const settings = normalizeLoadedSettings(
      { autoUpdate: "false", useWikiLinks: "true" },
      identity,
    );
    expect(settings.autoUpdate).toBe(DEFAULT_SETTINGS.autoUpdate);
    expect(settings.useWikiLinks).toBe(DEFAULT_SETTINGS.useWikiLinks);
  });
});

describe("coerceChangelogPath", () => {
  const identity = (p: string) => p;

  test("accepts a markdown path, normalized", () => {
    const stripTrailing = (p: string) => p.replace(/\/+$/, "");
    expect(coerceChangelogPath("Notes/Changelog.md/", stripTrailing)).toBe(
      "Notes/Changelog.md",
    );
  });

  test("falls back when the path is not markdown", () => {
    expect(coerceChangelogPath("Notes", identity)).toBe(
      DEFAULT_SETTINGS.changelogPath,
    );
    expect(coerceChangelogPath("Changelog.txt", identity)).toBe(
      DEFAULT_SETTINGS.changelogPath,
    );
  });

  test("falls back when the value is not a string", () => {
    expect(coerceChangelogPath(42, identity)).toBe(
      DEFAULT_SETTINGS.changelogPath,
    );
  });

  // The settings tab passes its current value, so a typo reverts to what the
  // user had rather than resetting the setting to Changelog.md.
  test("uses the supplied fallback instead of the default", () => {
    expect(coerceChangelogPath("Notes", identity, "Notes/Log.md")).toBe(
      "Notes/Log.md",
    );
  });
});

describe("coerceDatetimeFormat", () => {
  test("keeps a non-empty format", () => {
    expect(coerceDatetimeFormat("YYYY-MM-DD")).toBe("YYYY-MM-DD");
  });

  // moment's format("") falls through to ISO-8601 rather than failing, so an
  // empty persisted format silently turns every row into a full timestamp.
  test("falls back for an empty or whitespace-only format", () => {
    expect(coerceDatetimeFormat("")).toBe(DEFAULT_SETTINGS.datetimeFormat);
    expect(coerceDatetimeFormat("   ")).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });

  test("falls back when the value is not a string", () => {
    expect(coerceDatetimeFormat(42)).toBe(DEFAULT_SETTINGS.datetimeFormat);
    expect(coerceDatetimeFormat(null)).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });
});

describe("coerceExcludedFolders", () => {
  const identity = (p: string) => p;
  const stripTrailing = (p: string) => p.replace(/\/+$/, "");

  test("normalizes every entry", () => {
    expect(
      coerceExcludedFolders(["Archive/", "Templates/"], stripTrailing),
    ).toEqual(["Archive", "Templates"]);
  });

  // Normalization is exactly the operation that can make two distinct
  // persisted strings equal, and the Add button already refuses this state.
  test("de-duplicates entries that normalization makes equal", () => {
    expect(
      coerceExcludedFolders(["Archive/", "Archive"], stripTrailing),
    ).toEqual(["Archive"]);
  });

  test("drops every spelling of the vault root", () => {
    expect(
      coerceExcludedFolders(["", ".", "./", "/", "Archive"], identity),
    ).toEqual(["Archive"]);
  });

  test("falls back entirely when an entry is not a string", () => {
    expect(coerceExcludedFolders(["Archive", 42], identity)).toEqual(
      DEFAULT_SETTINGS.excludedFolders,
    );
  });

  test("falls back when the value is not an array", () => {
    expect(coerceExcludedFolders(null, identity)).toEqual(
      DEFAULT_SETTINGS.excludedFolders,
    );
  });

  test("copies the fallback rather than aliasing it", () => {
    const result = coerceExcludedFolders(null, identity);
    result.push("Mutated");
    expect(DEFAULT_SETTINGS.excludedFolders).toEqual([]);
  });
});

describe("isPluginGeneratedChangelog", () => {
  const entries =
    "- 2026-01-01T0900 \u00b7 [[Note A]]\n- 2026-01-02T1030 \u00b7 [[Note B]]\n";

  test('treats an empty file as its own (writeToFile creates with "")', () => {
    expect(isPluginGeneratedChangelog("", "")).toBe(true);
    expect(isPluginGeneratedChangelog("\n\n", "")).toBe(true);
  });

  test("accepts entries with no heading", () => {
    expect(isPluginGeneratedChangelog(entries, "")).toBe(true);
  });

  test("accepts a heading followed by entries", () => {
    expect(
      isPluginGeneratedChangelog(`## Recent\n\n${entries}`, "## Recent"),
    ).toBe(true);
  });

  test("accepts the configured heading alone, for an empty vault", () => {
    expect(isPluginGeneratedChangelog("## Recent\n", "## Recent")).toBe(true);
  });

  test("still accepts its own file after the heading setting changed", () => {
    // The heading slot tolerates a heading it does not recognise, so editing
    // changelogHeading cannot lock the plugin out of the file it wrote.
    expect(
      isPluginGeneratedChangelog(
        `## Old heading\n\n${entries}`,
        "## New heading",
      ),
    ).toBe(true);
  });

  test("rejects a one-line note", () => {
    expect(isPluginGeneratedChangelog("My grocery list\n", "")).toBe(false);
  });

  test("rejects prose", () => {
    expect(
      isPluginGeneratedChangelog("Meeting notes\n\nWe agreed to ship.\n", ""),
    ).toBe(false);
  });

  test("rejects a note that merely contains a list item", () => {
    expect(
      isPluginGeneratedChangelog(
        "Notes\n\n- milk \u00b7 eggs\n\nAnd then prose.\n",
        "",
      ),
    ).toBe(false);
  });

  test("rejects a checklist note", () => {
    expect(
      isPluginGeneratedChangelog("# Project\n\n- [ ] one\n- [ ] two\n", ""),
    ).toBe(false);
  });
});

describe("renderChangelog / isPluginGeneratedChangelog round-trip", () => {
  // The guard must never refuse the plugin's own output. This became
  // expressible only once renderChangelog was the single entry point; before
  // that there was no one function producing the file's whole content.
  const mk = (path: string, basename: string, mtime: number) => ({
    path,
    basename,
    stat: { mtime },
  });
  const byPath = (file: { path: string }) => file.path.replace(/\.md$/, "");

  const cases: [
    string,
    ReturnType<typeof mk>[],
    Partial<typeof DEFAULT_SETTINGS>,
  ][] = [
    ["empty vault", [], {}],
    ["empty vault with a heading", [], { changelogHeading: "## Recent" }],
    ["entries only", [mk("A.md", "A", 1), mk("B.md", "B", 2)], {}],
    [
      "entries under a heading",
      [mk("A.md", "A", 1)],
      { changelogHeading: "## Recent" },
    ],
    ["plain text mode", [mk("A.md", "A", 1)], { useWikiLinks: false }],
    [
      "plain text under a heading",
      [mk("A.md", "A", 1)],
      { useWikiLinks: false, changelogHeading: "# Log" },
    ],
    ["duplicate basenames", [mk("x/N.md", "N", 1), mk("y/N.md", "N", 2)], {}],
  ];

  for (const [label, files, overrides] of cases) {
    test(`accepts its own output: ${label}`, () => {
      const settings = { ...DEFAULT_SETTINGS, ...overrides };
      const output = renderChangelog(files, settings, formatter, byPath);
      expect(
        isPluginGeneratedChangelog(output, settings.changelogHeading),
      ).toBe(true);
    });
  }
});

describe("validateExcludedFolder", () => {
  test("accepts a new folder", () => {
    expect(validateExcludedFolder("Archive", [])).toBe("ok");
  });

  // Written against post-normalization shapes, which is what the parameter
  // name and the doc comment promise. Which of these normalizePath actually
  // returns for empty input is version-dependent, so all four are rejected.
  test("rejects every spelling of the vault root", () => {
    for (const marker of ["", ".", "./", "/", "  "]) {
      expect(validateExcludedFolder(marker, [])).toBe("invalid");
    }
  });

  test("rejects empty input and the vault root", () => {
    expect(validateExcludedFolder("", [])).toBe("invalid");
    expect(validateExcludedFolder(".", [])).toBe("invalid");
  });

  test("flags an already-listed folder as duplicate", () => {
    expect(validateExcludedFolder("Archive", ["Archive"])).toBe("duplicate");
  });
});
