import { z } from "zod";
import { getClient } from "./tagging.js";

const categorizeResultSchema = z.object({
  categories: z.array(z.object({ name: z.string(), bookmarkIds: z.array(z.number()) })),
});
export type CategorizeResult = z.infer<typeof categorizeResultSchema>;

interface CandidateBookmark {
  id: number;
  title: string;
  tags: string[];
}

export async function suggestCategories(
  items: CandidateBookmark[],
  existingCategories: string[]
): Promise<CategorizeResult> {
  const response = await getClient().chat.completions.create({
    model: "deepseek-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Group bookmarks into a small number of broad categories — big topic areas a person " +
          'would use to bundle up many bookmarks, like "travel", "news", or "computer science" ' +
          '(NOT narrow/specific topics like "react hooks" or "paris hotels" — those are tags, ' +
          "not categories). Aim for roughly 5-15 categories total. Reuse an existing category " +
          "name whenever a bookmark fits one, instead of inventing a near-duplicate. Every " +
          'bookmark id given must appear in exactly one category. Respond with strict JSON ' +
          '{"categories": [{"name": string, "bookmarkIds": number[]}]}. No prose outside the JSON.',
      },
      {
        role: "user",
        content: JSON.stringify({ existingCategories, bookmarks: items }),
      },
    ],
    stream: false,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  return categorizeResultSchema.parse(JSON.parse(raw));
}
