import { describe, it, expect } from "vitest";
import { semverSort } from "../../src/lib/utils.js";

describe("semverSort", () => {
  it("sorts by major version correctly", () => {
    expect(semverSort(["v9.0.0", "v20.0.0", "v18.0.0"])).toEqual([
      "v9.0.0", "v18.0.0", "v20.0.0",
    ]);
  });

  it("sorts by minor version", () => {
    expect(semverSort(["v20.3.0", "v20.1.0", "v20.10.0"])).toEqual([
      "v20.1.0", "v20.3.0", "v20.10.0",
    ]);
  });

  it("sorts by patch version", () => {
    expect(semverSort(["v20.1.3", "v20.1.1", "v20.1.10"])).toEqual([
      "v20.1.1", "v20.1.3", "v20.1.10",
    ]);
  });

  it("pop() returns the highest version", () => {
    const result = semverSort(["v9.11.2", "v20.1.0", "v18.17.1"]).pop();
    expect(result).toBe("v20.1.0");
  });

  it("handles versions without v prefix", () => {
    expect(semverSort(["9.0.0", "20.0.0", "18.0.0"])).toEqual([
      "9.0.0", "18.0.0", "20.0.0",
    ]);
  });

  it("handles single version", () => {
    expect(semverSort(["v22.0.0"])).toEqual(["v22.0.0"]);
  });

  it("handles empty array", () => {
    expect(semverSort([])).toEqual([]);
  });

  it("does not mutate original array", () => {
    const original = ["v20.0.0", "v18.0.0"];
    semverSort(original);
    expect(original).toEqual(["v20.0.0", "v18.0.0"]);
  });
});
