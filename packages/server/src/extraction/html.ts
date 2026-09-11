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
