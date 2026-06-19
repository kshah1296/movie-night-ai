import { describe, it, expect } from "vitest";
import { posterUrl, genreIdsToNames, TMDB_IMAGE_BASE } from "@/lib/tmdb";

describe("posterUrl", () => {
  it("returns null for missing paths", () => {
    expect(posterUrl(null)).toBeNull();
    expect(posterUrl(undefined)).toBeNull();
    expect(posterUrl("")).toBeNull();
  });

  it("builds a full TMDB image url", () => {
    expect(posterUrl("/abc.jpg")).toBe(`${TMDB_IMAGE_BASE}/abc.jpg`);
  });
});

describe("genreIdsToNames", () => {
  it("maps known ids to names", () => {
    expect(genreIdsToNames([28, 18])).toEqual(["Action", "Drama"]);
  });

  it("drops unknown ids", () => {
    expect(genreIdsToNames([28, 99999])).toEqual(["Action"]);
  });

  it("handles an empty list", () => {
    expect(genreIdsToNames([])).toEqual([]);
  });
});
