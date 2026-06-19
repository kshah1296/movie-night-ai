import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock the network layer so the hook is tested in isolation.
const batchMock = vi.fn();
vi.mock("@/lib/api", () => ({
  getMovieRatingsBatch: (ids: number[]) => batchMock(ids),
}));

import { useCardRatings } from "@/lib/ratings";

beforeEach(() => {
  batchMock.mockReset();
});

describe("useCardRatings", () => {
  it("fetches and returns ratings for the given ids", async () => {
    batchMock.mockResolvedValue({ "1": { imdb: "8.8" } });
    const { result } = renderHook(() => useCardRatings([1]));
    await waitFor(() => expect(result.current[1]?.imdb).toBe("8.8"));
    expect(batchMock).toHaveBeenCalledOnce();
  });

  it("serves cached ratings without refetching (dedupe across mounts)", async () => {
    batchMock.mockResolvedValue({ "2": { imdb: "7.0" } });
    const first = renderHook(() => useCardRatings([2]));
    await waitFor(() => expect(first.result.current[2]?.imdb).toBe("7.0"));
    first.unmount();

    batchMock.mockClear();
    const second = renderHook(() => useCardRatings([2]));
    expect(second.result.current[2]?.imdb).toBe("7.0"); // from cache, no await
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("does not fetch for an empty id list", () => {
    renderHook(() => useCardRatings([]));
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("never overwrites good data when a later fetch fails", async () => {
    batchMock.mockResolvedValueOnce({ "3": { imdb: "9.1" } });
    const { result } = renderHook(() => useCardRatings([3]));
    await waitFor(() => expect(result.current[3]?.imdb).toBe("9.1"));
    // A subsequent failure must not blank out the already-cached score.
    batchMock.mockRejectedValue(new Error("network down"));
    renderHook(() => useCardRatings([3, 4]));
    await waitFor(() => expect(result.current[3]?.imdb).toBe("9.1"));
  });
});
