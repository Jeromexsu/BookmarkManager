// Not a declared content script — injected on demand via browser.scripting.executeScript
// when the user clicks "Save", so we don't run on every page load.
export function extractPageContent() {
  return {
    title: document.title,
    url: location.href,
    content: document.body?.innerText?.slice(0, 20000) ?? "",
  };
}
