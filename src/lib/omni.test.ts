import { describe, expect, it } from "vitest";
import { folderChipLabel } from "./omni";

const EXAMPLE = {
  path: "/Users/jeroen/Projects/other/sift/example_samples",
  name: "example_samples",
};
const SAMPLES = { path: "/Volumes/Samples", name: "Samples" };
const ROOTS = [EXAMPLE, SAMPLES];

describe("folderChipLabel", () => {
  it("uses the root name when the root itself is selected", () => {
    expect(folderChipLabel(EXAMPLE.path, ROOTS)).toBe("example_samples");
  });

  it("prefixes nested folders with the root name", () => {
    expect(folderChipLabel(`${EXAMPLE.path}/limbowrld_drumkit/808s`, ROOTS)).toBe(
      "example_samples/limbowrld_drumkit/808s",
    );
  });

  it("picks the longest matching root", () => {
    const nested = [...ROOTS, { path: `${EXAMPLE.path}/limbowrld_drumkit`, name: "limbowrld_drumkit" }];
    expect(folderChipLabel(`${EXAMPLE.path}/limbowrld_drumkit/808s`, nested)).toBe(
      "limbowrld_drumkit/808s",
    );
  });

  it("falls back to the absolute path when no root matches", () => {
    expect(folderChipLabel("/tmp/orphan", ROOTS)).toBe("/tmp/orphan");
  });
});
