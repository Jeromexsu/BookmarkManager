import OpenAI from "openai";
import { z } from "zod";

const taggingResultSchema = z.object({
  tags: z.array(z.string()).max(8),
  summary: z.string(),
});
export type TaggingResult = z.infer<typeof taggingResultSchema>;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not set");
    }
    client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
  }
  return client;
}

const MAX_CONTENT_CHARS = 12000;

export async function generateTags(content: string): Promise<TaggingResult> {
  const truncated = content.slice(0, MAX_CONTENT_CHARS);

  const response = await getClient().chat.completions.create({
    model: "deepseek-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You tag bookmarked web pages. Given page content, respond with strict JSON " +
          '{"tags": string[] (up to 5, lowercase, short), "summary": string (one sentence)}. ' +
          "No prose outside the JSON.",
      },
      { role: "user", content: truncated },
    ],
    stream: false,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  return taggingResultSchema.parse(JSON.parse(raw));
}
