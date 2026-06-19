import { describe, it, expect } from "vitest";
import { providerLink } from "@/lib/providers";

describe("providerLink", () => {
  it("deep-links known providers with the title searched", () => {
    const url = providerLink(8, "Kill Bill"); // Netflix
    expect(url).toContain("netflix.com");
    expect(url).toContain(encodeURIComponent("Kill Bill"));
  });

  it("uses the fallback for unknown provider ids", () => {
    expect(providerLink(999999, "X", "https://justwatch.com/x")).toBe("https://justwatch.com/x");
  });

  it("returns undefined for an unknown provider with no fallback", () => {
    expect(providerLink(999999, "X")).toBeUndefined();
  });

  it("url-encodes titles with special characters", () => {
    const url = providerLink(337, "Spider-Man: No Way Home"); // Disney+
    expect(url).toContain(encodeURIComponent("Spider-Man: No Way Home"));
    expect(url).not.toContain(" ");
  });
});
