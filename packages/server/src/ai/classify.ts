import { z } from "zod";
import { getClient } from "./tagging.js";

const classifyResultSchema = z.object({
  isShortcut: z.boolean(),
  reason: z.string(),
});
export type ClassifyResult = z.infer<typeof classifyResultSchema>;

// Much less content is needed than for tagging — this only has to tell "portal page" from
// "actual content," not summarize anything.
const MAX_CONTENT_CHARS = 4000;

export async function classifyShortcut(title: string, content: string): Promise<ClassifyResult> {
  const truncated = content.slice(0, MAX_CONTENT_CHARS);

  const response = await getClient().chat.completions.create({
    model: "deepseek-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Decide whether a bookmarked page is a "shortcut" — a homepage/portal/entrance page ' +
          "whose purpose is just navigating to other content (nav links, a search box, a logo, " +
          'minimal unique text) — versus "reference" — it has actual standalone content worth ' +
          "reading (an article, documentation, a specific post, a product page, etc). Respond " +
          'with strict JSON {"isShortcut": boolean, "reason": string (short)}. No prose outside ' +
          "the JSON.",
      },
      { role: "user", content: `Title: ${title}\n\nContent:\n${truncated}` },
    ],
    stream: false,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  return classifyResultSchema.parse(JSON.parse(raw));
}
