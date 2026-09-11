// Deliberately crude, best-effort text extraction for bulk-imported bookmarks -- no headless
// browser, no JS rendering. Pages that need either of those (SPAs, anti-scraping walls) will
// just yield too little text and get saved untagged rather than failing the import outright.
export function extractTextFromHtml(html: string): string {
  const withoutNonContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  return withoutNonContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    // Postgres text columns reject NUL bytes outright; some pages (odd encodings, binary
    // content misidentified as HTML) leak them through untouched by the above.
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Firefox's bookmarks API exposes no favicon, and imported bookmarks aren't open tabs (the
// normal Save flow reads tab.favIconUrl instead) — so pull one from the page we already fetched.
export function extractFaviconUrl(html: string, pageUrl: string): string | null {
  const linkMatch = html.match(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*>/i);
  const hrefMatch = linkMatch?.[0].match(/href=["']([^"']+)["']/i);

  try {
    if (hrefMatch) {
      return new URL(hrefMatch[1], pageUrl).toString();
    }
    return new URL("/favicon.ico", pageUrl).toString();
  } catch {
    return null;
  }
}
