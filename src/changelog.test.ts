import { describe, expect, test } from "bun:test";
import moment from "moment";

// @ts-expect-error global mock
globalThis.window = { moment };

import { filterAndSort, generateChangelog } from "./changelog";

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

  test("handles empty excluded folders", () => {
    const result = filterAndSort(files, "Changelog.md", [], 25);
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
    const result = generateChangelog(files, "YYYY-MM-DD[T]HHmm", true, "");
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 [[Note B]]\n- 2026-01-15T1400 \u00b7 [[Note A]]\n",
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
