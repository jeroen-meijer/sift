import { describe, expect, it } from "vitest";
import { folderChipLabel } from "./omni";

const LIBRARY = {
  path: "/tmp/Library",
  name: "Library",
};
const SAMPLES = { path: "/Volumes/Samples", name: "Samples" };
const ROOTS = [LIBRARY, SAMPLES];

describe("folderChipLabel", () => {
  it("uses the root name when the root itself is selected", () => {
    expect(folderChipLabel(LIBRARY.path, ROOTS)).toBe("Library");
  });

  it("prefixes nested folders with the root name", () => {
    expect(folderChipLabel(`${LIBRARY.path}/Drums/808s`, ROOTS)).toBe(
      "Library/Drums/808s",
    );
  });

  it("prefixes a sample file path with the root name", () => {
    expect(
      folderChipLabel(`${LIBRARY.path}/Studio/sounds/packs/lead.wav`, ROOTS),
    ).toBe("Library/Studio/sounds/packs/lead.wav");
  });

  it("picks the longest matching root", () => {
    const nested = [
      ...ROOTS,
      { path: `${LIBRARY.path}/Drums`, name: "Drums" },
    ];
    expect(folderChipLabel(`${LIBRARY.path}/Drums/808s`, nested)).toBe(
      "Drums/808s",
    );
  });

  it("falls back to the absolute path when no root matches", () => {
    expect(folderChipLabel("/tmp/orphan", ROOTS)).toBe("/tmp/orphan");
  });
});
