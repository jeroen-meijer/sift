import { describe, expect, it } from "vitest";
import { groupByFolder } from "./askIndex";

describe("groupByFolder", () => {
  it("groups new files under their parent folder, first seen first", () => {
    expect(
      groupByFolder([
        "/Samples/Drums/Breaks/a.wav",
        "/Samples/Synths/b.wav",
        "/Samples/Drums/Breaks/c.wav",
      ]),
    ).toEqual([
      { folder: "/Samples/Drums/Breaks", paths: ["/Samples/Drums/Breaks/a.wav", "/Samples/Drums/Breaks/c.wav"] },
      { folder: "/Samples/Synths", paths: ["/Samples/Synths/b.wav"] },
    ]);
  });

  it("puts a file at the filesystem root under /", () => {
    expect(groupByFolder(["/loose.wav"])).toEqual([{ folder: "/", paths: ["/loose.wav"] }]);
  });

  it("returns nothing for nothing", () => {
    expect(groupByFolder([])).toEqual([]);
  });
});
