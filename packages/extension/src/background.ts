import browser from "webextension-polyfill";
import { extractPageContent } from "./content.js";

interface ExtractedPage {
  url: string;
  title: string;
  content: string;
}

interface PreviewData extends ExtractedPage {
  tags: string[];
  category: string;
  summary: string;
  warning?: string;
}

type PreviewResult = { ok: true; data: PreviewData } | { ok: false; error: string };
type SaveResult = { ok: true } | { ok: false; error: string };

async function getServerUrl(): Promise<string | null> {
  const { serverUrl } = await browser.storage.sync.get("serverUrl");
  return typeof serverUrl === "string" && serverUrl ? serverUrl : null;
}

async function extractActiveTab(): Promise<ExtractedPage | { error: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { error: "No active tab found." };
  }

  const [injected] = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent,
  });
  return injected.result as ExtractedPage;
}

async function previewCurrentTab(): Promise<PreviewResult> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension options first." };
  }

  const extracted = await extractActiveTab();
  if ("error" in extracted) {
    return { ok: false, error: extracted.error };
  }

  if (!extracted.content.trim()) {
    return {
      ok: true,
      data: { ...extracted, tags: [], category: "", summary: "", warning: "No page content extracted — tags unavailable." },
    };
  }

  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(extracted),
    });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const preview = (await res.json()) as { tags: string[]; category: string; summary: string };
    return { ok: true, data: { ...extracted, ...preview } };
  } catch {
    return {
      ok: true,
      data: { ...extracted, tags: [], category: "", summary: "", warning: "Couldn't generate tags automatically." },
    };
  }
}

async function confirmSave(payload: PreviewData): Promise<SaveResult> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension options first." };
  }

  const { warning, ...body } = payload;
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, error: `Server responded with ${res.status}` };
  }
  return { ok: true };
}

type IncomingMessage =
  | { type: "PREVIEW_CURRENT_TAB" }
  | { type: "CONFIRM_SAVE"; payload: PreviewData };

browser.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as IncomingMessage;
  if (message?.type === "PREVIEW_CURRENT_TAB") return previewCurrentTab();
  if (message?.type === "CONFIRM_SAVE") return confirmSave(message.payload);
});
