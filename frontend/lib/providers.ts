// Best-effort deep links to each streaming/store service, keyed by TMDB provider_id.
// TMDB/JustWatch does not expose per-title provider URLs, so these open the provider
// with the movie title pre-searched. Unknown providers fall back to the JustWatch page.

type LinkFn = (q: string) => string;

const PROVIDER_LINKS: Record<number, LinkFn> = {
  8:    (q) => `https://www.netflix.com/search?q=${q}`,                          // Netflix
  9:    (q) => `https://www.amazon.com/s?k=${q}&i=instant-video`,                // Amazon Prime Video
  119:  (q) => `https://www.amazon.com/s?k=${q}&i=instant-video`,                // Amazon Prime Video
  10:   (q) => `https://www.amazon.com/s?k=${q}&i=instant-video`,                // Amazon Video (rent/buy)
  337:  (q) => `https://www.disneyplus.com/search?q=${q}`,                       // Disney+
  15:   (q) => `https://www.hulu.com/search?q=${q}`,                             // Hulu
  1899: (q) => `https://play.max.com/search?q=${q}`,                            // Max
  384:  (q) => `https://play.max.com/search?q=${q}`,                            // HBO Max (legacy id)
  350:  (q) => `https://tv.apple.com/search?term=${q}`,                          // Apple TV+
  2:    (q) => `https://tv.apple.com/search?term=${q}`,                          // Apple TV (rent/buy)
  531:  (q) => `https://www.paramountplus.com/search/?query=${q}`,               // Paramount+
  386:  (q) => `https://www.peacocktv.com/search?q=${q}`,                        // Peacock
  387:  (q) => `https://www.peacocktv.com/search?q=${q}`,                        // Peacock Premium
  3:    (q) => `https://play.google.com/store/search?q=${q}&c=movies`,           // Google Play Movies
  192:  (q) => `https://www.youtube.com/results?search_query=${q}`,              // YouTube
  7:    (q) => `https://www.vudu.com/content/movies/search?searchString=${q}`,   // Fandango at Home (Vudu)
  68:   (q) => `https://www.microsoft.com/en-us/search/shop/movies?q=${q}`,      // Microsoft Store
};

/** Returns a clickable URL for a provider on a given title, or `fallback`
 * (the JustWatch page) when we don't have a template for that provider. */
export function providerLink(providerId: number, title: string, fallback?: string): string | undefined {
  const fn = PROVIDER_LINKS[providerId];
  return fn ? fn(encodeURIComponent(title)) : fallback;
}
