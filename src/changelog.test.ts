import { describe, expect, test } from "bun:test";
import moment from "moment";

import {
  changelogPathError,
  clampMaxRecentFiles,
  DEFAULT_SETTINGS,
  datetimeFormatError,
  filterAndSort,
  generateChangelog,
  maxRecentFilesError,
  normalizeLoadedSettings,
  validateExcludedFolder,
} from "./changelog";

const formatter = (mtime: number, fmt: string) => moment(mtime).format(fmt);

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

describe("generateChangelog", () => {
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
    const result = generateChangelog(
      files,
      "YYYY-MM-DD[T]HHmm",
      true,
      "",
      formatter,
    );
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 [[Note B]]\n- 2026-01-15T1400 \u00b7 [[Note A]]\n",
    );
  });

  test("generates changelog without wiki-links", () => {
    const result = generateChangelog(
      files,
      "YYYY-MM-DD[T]HHmm",
      false,
      "",
      formatter,
    );
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 Note B\n- 2026-01-15T1400 \u00b7 Note A\n",
    );
  });

  test("generates changelog with heading", () => {
    const result = generateChangelog(
      files,
      "YYYY-MM-DD[T]HHmm",
      true,
      "# Changelog",
      formatter,
    );
    expect(result).toStartWith("# Changelog\n\n");
  });

  test("generates empty changelog", () => {
    const result = generateChangelog(
      [],
      "YYYY-MM-DD[T]HHmm",
      true,
      "",
      formatter,
    );
    expect(result).toBe("");
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

describe("changelogPathError", () => {
  test("accepts a markdown path", () => {
    expect(changelogPathError("Notes/Changelog.md")).toBeUndefined();
  });

  test("rejects non-markdown paths", () => {
    expect(changelogPathError("Changelog.txt")).toBeString();
    expect(changelogPathError("Changelog")).toBeString();
  });
});

describe("datetimeFormatError", () => {
  test("accepts a format", () => {
    expect(datetimeFormatError("YYYY-MM-DD")).toBeUndefined();
  });

  test("rejects an empty or blank format", () => {
    expect(datetimeFormatError("")).toBeString();
    expect(datetimeFormatError("   ")).toBeString();
  });
});

describe("maxRecentFilesError", () => {
  test("accepts whole numbers in range, typed or numeric", () => {
    for (const ok of [1, 25, 500, "42"]) {
      expect(maxRecentFilesError(ok)).toBeUndefined();
    }
  });

  test("refuses what the load coercion would silently clamp or replace", () => {
    for (const bad of [0, -5, 501, 2.5, "abc", "", null, Number.NaN]) {
      expect(maxRecentFilesError(bad)).toBeString();
    }
  });
});

describe("loading settings by rule", () => {
  const identity = (p: string) => p;

  test("clampMaxRecentFiles falls back for every non-numeric value (#209)", () => {
    for (const bad of [null, "", "  ", [], false, true, {}]) {
      expect(clampMaxRecentFiles(bad)).toBe(DEFAULT_SETTINGS.maxRecentFiles);
    }
  });

  test("non-object data loads as the defaults", () => {
    for (const raw of ["junk", 42, true, []]) {
      expect(normalizeLoadedSettings(raw, identity)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test("root entries are dropped from excludedFolders on load (#204)", () => {
    expect(
      normalizeLoadedSettings(
        { excludedFolders: ["", ".", "Archive", "/", "./"] },
        identity,
      ).excludedFolders,
    ).toEqual(["Archive"]);
  });

  test("a valid persisted path and format load unchanged", () => {
    const settings = normalizeLoadedSettings(
      { changelogPath: "Logs/Recent.md", datetimeFormat: "HH:mm" },
      identity,
    );
    expect(settings.changelogPath).toBe("Logs/Recent.md");
    expect(settings.datetimeFormat).toBe("HH:mm");
  });
});

describe("validateExcludedFolder", () => {
  test("accepts a new folder", () => {
    expect(validateExcludedFolder("Archive", [])).toBe("ok");
  });

  test("rejects empty input and the vault root", () => {
    expect(validateExcludedFolder("", [])).toBe("invalid");
    expect(validateExcludedFolder(".", [])).toBe("invalid");
  });

  test("flags an already-listed folder as duplicate", () => {
    expect(validateExcludedFolder("Archive", ["Archive"])).toBe("duplicate");
  });
});

// Defects recorded before 2.0.0 fixed them (#263): each was pinned as
// test.failing first, then flipped by the step that fixed it.
describe("2.0.0 baseline", () => {
  const identity = (p: string) => p;
  const stripTrailing = (p: string) => p.replace(/\/+$/, "");

  test("the loader never hands out the default excludedFolders array (#266)", () => {
    expect(normalizeLoadedSettings(null, identity).excludedFolders).not.toBe(
      DEFAULT_SETTINGS.excludedFolders,
    );
    expect(normalizeLoadedSettings({}, identity).excludedFolders).not.toBe(
      DEFAULT_SETTINGS.excludedFolders,
    );
    expect(
      normalizeLoadedSettings({ excludedFolders: [1] }, identity)
        .excludedFolders,
    ).not.toBe(DEFAULT_SETTINGS.excludedFolders);
  });

  test("a null maxRecentFiles falls back to the default (#209)", () => {
    expect(clampMaxRecentFiles(null)).toBe(DEFAULT_SETTINGS.maxRecentFiles);
  });

  test("a persisted non-markdown changelogPath falls back on load (#213)", () => {
    expect(
      normalizeLoadedSettings({ changelogPath: "Notes" }, identity)
        .changelogPath,
    ).toBe(DEFAULT_SETTINGS.changelogPath);
  });

  test("a persisted empty datetimeFormat falls back on load (#213)", () => {
    expect(
      normalizeLoadedSettings({ datetimeFormat: "" }, identity).datetimeFormat,
    ).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });

  test("every spelling of the vault root is invalid (#204)", () => {
    for (const root of ["", ".", "./", "/"]) {
      expect(validateExcludedFolder(root, [])).toBe("invalid");
    }
  });

  test("excluded folders that normalize alike load as one (#211)", () => {
    expect(
      normalizeLoadedSettings(
        { excludedFolders: ["Archive/", "Archive"] },
        stripTrailing,
      ).excludedFolders,
    ).toEqual(["Archive"]);
  });
});
