import browser from "webextension-polyfill";
import { extractPageContent } from "./content.js";

type SaveResult = { ok: true } | { ok: false; error: string };

async function getServerUrl(): Promise<string | null> {
  const { serverUrl } = await browser.storage.sync.get("serverUrl");
  return typeof serverUrl === "string" && serverUrl ? serverUrl : null;
}

async function saveCurrentTab(): Promise<SaveResult> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension options first." };
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab found." };
  }

  const [injected] = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent,
  });

  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(injected.result),
  });

  if (!res.ok) {
    return { ok: false, error: `Server responded with ${res.status}` };
  }
  return { ok: true };
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "SAVE_CURRENT_TAB") {
    return saveCurrentTab();
  }
});
