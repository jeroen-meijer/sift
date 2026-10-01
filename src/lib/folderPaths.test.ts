import { describe, expect, it } from "vitest";
import {
  ancestorPathsToExpand,
  findFolderIndex,
  folderPathsEqual,
  normFolderPath,
} from "./folderPaths";

describe("normFolderPath", () => {
  it("converts backslashes", () => {
    expect(normFolderPath("C:\\Samples\\Drums")).toBe("C:/Samples/Drums");
  });
});

describe("folderPathsEqual", () => {
  it("ignores separator style", () => {
    expect(folderPathsEqual("/a/b", "/a/b")).toBe(true);
    expect(folderPathsEqual("C:\\a\\b", "C:/a/b")).toBe(true);
    expect(folderPathsEqual("/a/b", "/a/c")).toBe(false);
  });
});

describe("ancestorPathsToExpand", () => {
  it("lists existing ancestors closest-first", () => {
    const folders = new Set(["/lib", "/lib/Drums", "/lib/Drums/Kicks"]);
    expect(ancestorPathsToExpand("/lib/Drums/Kicks/Tight", folders)).toEqual([
      "/lib/Drums/Kicks",
      "/lib/Drums",
      "/lib",
    ]);
  });

  it("skips path segments that are not folders in the tree", () => {
    const folders = new Set(["/lib", "/lib/Drums/Kicks"]);
    expect(ancestorPathsToExpand("/lib/Drums/Kicks/file-parent", folders)).toEqual([
      "/lib/Drums/Kicks",
      "/lib",
    ]);
  });

  it("returns nothing for a root selection", () => {
    expect(ancestorPathsToExpand("/lib", new Set(["/lib"]))).toEqual([]);
  });
});

describe("findFolderIndex", () => {
  const folders = [{ path: "/lib" }, { path: "/lib/Drums" }, { path: "/lib/Drums/Kicks" }];

  it("finds a path", () => {
    expect(findFolderIndex(folders, "/lib/Drums")).toBe(1);
  });

  it("returns -1 when missing", () => {
    expect(findFolderIndex(folders, "/lib/FX")).toBe(-1);
  });
});
