import { z } from "zod";
import { getClient } from "./tagging.js";

const titleResultSchema = z.object({ title: z.string() });

const MAX_CONTENT_CHARS = 6000;

export async function suggestTitle(currentTitle: string, content: string): Promise<string> {
  const truncated = content.slice(0, MAX_CONTENT_CHARS);

  const response = await getClient().chat.completions.create({
    model: "deepseek-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Suggest a clean, accurate title for a bookmarked page, based on its content. Keep it " +
          'concise (under ~80 characters), strip any site-name suffix/prefix (e.g. drop " - ' +
          'Example.com" or "Example.com | "), no clickbait, no surrounding quotes. Respond with ' +
          'strict JSON {"title": string}. No prose outside the JSON.',
      },
      { role: "user", content: `Current title: ${currentTitle}\n\nContent:\n${truncated}` },
    ],
    stream: false,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  return titleResultSchema.parse(JSON.parse(raw)).title;
}
