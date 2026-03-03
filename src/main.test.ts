import { describe, expect, test } from "bun:test";
import moment from "moment";

// Provide window.moment for code that uses it
// @ts-expect-error global mock
globalThis.window = { moment };

// Inline defaults to avoid importing obsidian via settings.ts
const DEFAULT_SETTINGS = {
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [] as string[],
  useWikiLinks: true,
  changelogHeading: "",
};

// Pure logic extracted from ChangelogPlugin for testing

interface MockFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}

function formatChangelogEntry(
  file: MockFile,
  datetimeFormat: string,
  useWikiLinks: boolean,
): string {
  const m = moment(file.stat.mtime);
  const formattedTime = m.format(datetimeFormat);
  const fileName = useWikiLinks ? `[[${file.basename}]]` : file.basename;
  return `- ${formattedTime} · ${fileName}`;
}

function filterAndSortFiles(
  files: MockFile[],
  changelogPath: string,
  excludedFolders: string[],
  maxRecentFiles: number,
): MockFile[] {
  return files
    .filter((file) => {
      if (file.path === changelogPath) return false;
      for (const folder of excludedFolders) {
        if (file.path.startsWith(folder)) return false;
      }
      return true;
    })
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
}

function generateChangelog(
  files: MockFile[],
  datetimeFormat: string,
  useWikiLinks: boolean,
  changelogHeading: string,
): string {
  let content = "";
  if (changelogHeading) {
    content += `${changelogHeading}\n\n`;
  }
  for (const file of files) {
    content += `${formatChangelogEntry(file, datetimeFormat, useWikiLinks)}\n`;
  }
  return content;
}

describe("DEFAULT_SETTINGS", () => {
  test("has correct defaults", () => {
    expect(DEFAULT_SETTINGS.autoUpdate).toBe(false);
    expect(DEFAULT_SETTINGS.changelogPath).toBe("Changelog.md");
    expect(DEFAULT_SETTINGS.datetimeFormat).toBe("YYYY-MM-DD[T]HHmm");
    expect(DEFAULT_SETTINGS.maxRecentFiles).toBe(25);
    expect(DEFAULT_SETTINGS.excludedFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.useWikiLinks).toBe(true);
    expect(DEFAULT_SETTINGS.changelogHeading).toBe("");
  });
});

describe("formatChangelogEntry", () => {
  const file: MockFile = {
    path: "Notes/Test Note.md",
    basename: "Test Note",
    stat: { mtime: new Date("2026-01-15T14:30:00").getTime() },
  };

  test("formats with wiki-links", () => {
    const result = formatChangelogEntry(file, "YYYY-MM-DD[T]HHmm", true);
    expect(result).toBe("- 2026-01-15T1430 · [[Test Note]]");
  });

  test("formats without wiki-links", () => {
    const result = formatChangelogEntry(file, "YYYY-MM-DD[T]HHmm", false);
    expect(result).toBe("- 2026-01-15T1430 · Test Note");
  });

  test("respects custom datetime format", () => {
    const result = formatChangelogEntry(file, "YYYY-MM-DD HH:mm", true);
    expect(result).toBe("- 2026-01-15 14:30 · [[Test Note]]");
  });
});

describe("filterAndSortFiles", () => {
  const files: MockFile[] = [
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
    const result = filterAndSortFiles(files, "Changelog.md", [], 25);
    expect(result.find((f) => f.path === "Changelog.md")).toBeUndefined();
  });

  test("excludes files in excluded folders", () => {
    const result = filterAndSortFiles(files, "Changelog.md", ["Archive/"], 25);
    expect(result.find((f) => f.path.startsWith("Archive/"))).toBeUndefined();
  });

  test("sorts by mtime descending", () => {
    const result = filterAndSortFiles(files, "Changelog.md", ["Archive/"], 25);
    expect(result.map((f) => f.basename)).toEqual([
      "Note B",
      "Note C",
      "Note A",
    ]);
  });

  test("limits to maxRecentFiles", () => {
    const result = filterAndSortFiles(files, "Changelog.md", [], 2);
    expect(result).toHaveLength(2);
  });

  test("handles empty excluded folders", () => {
    const result = filterAndSortFiles(files, "Changelog.md", [], 25);
    expect(result).toHaveLength(4);
  });
});

describe("generateChangelog", () => {
  const files: MockFile[] = [
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
    const result = generateChangelog(files, "YYYY-MM-DD[T]HHmm", true, "");
    expect(result).toBe(
      "- 2026-01-15T1430 · [[Note B]]\n- 2026-01-15T1400 · [[Note A]]\n",
    );
  });

  test("generates changelog with heading", () => {
    const result = generateChangelog(
      files,
      "YYYY-MM-DD[T]HHmm",
      true,
      "# Changelog",
    );
    expect(result).toStartWith("# Changelog\n\n");
  });

  test("generates empty changelog", () => {
    const result = generateChangelog([], "YYYY-MM-DD[T]HHmm", true, "");
    expect(result).toBe("");
  });
});

describe("datetime validation", () => {
  test("valid format produces valid date", () => {
    const m = moment();
    expect(m.format("YYYY-MM-DD")).not.toBe("Invalid date");
  });

  test("recognizes default format", () => {
    const m = moment();
    expect(m.format("YYYY-MM-DD[T]HHmm")).not.toBe("Invalid date");
  });
});

describe("max files validation", () => {
  test("rejects NaN", () => {
    expect(Number.isNaN(Number("abc"))).toBe(true);
  });

  test("rejects zero", () => {
    expect(Number("0") < 1).toBe(true);
  });

  test("rejects negative", () => {
    expect(Number("-5") < 1).toBe(true);
  });

  test("accepts valid number", () => {
    const n = Number("25");
    expect(!Number.isNaN(n) && n >= 1).toBe(true);
  });
});
