import { z } from "zod";
import { getClient } from "./tagging.js";

export interface CandidateBookmark {
  id: number;
  title: string;
  tags: string[];
}

export interface CategoryInfo {
  name: string;
  description: string | null;
}

const classifyChunkResultSchema = z.object({
  assignments: z.array(z.object({ id: z.number(), category: z.string() })),
});

const CHUNK_TIMEOUT_MS = 60_000;

// Classifies one chunk against the current, already-curated category list — no room for the
// model to invent new categories here (that's a separate, deliberate "reorganize categories"
// decision, not something that happens as a side effect of every classify run). Chunked with a
// worker pool at the call site so any one call's output stays small — see bookmarks.ts.
export async function classifyChunk(items: CandidateBookmark[], categories: CategoryInfo[]): Promise<Map<string, number[]>> {
  const response = await getClient().chat.completions.create(
    {
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Assign each given bookmark to exactly one of the given categories, based on its " +
            "title and tags (use each category's description, when given, to judge fit). " +
            'Respond with strict JSON {"assignments": [{"id": number, "category": string}]} — ' +
            'one entry per bookmark id given, "category" must be exactly one of the provided ' +
            "category names, verbatim. No prose outside the JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({ categories, bookmarks: items }),
        },
      ],
      stream: false,
    },
    { timeout: CHUNK_TIMEOUT_MS }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  const parsed = classifyChunkResultSchema.parse(JSON.parse(raw));
  const categorySet = new Set(categories.map((c) => c.name));
  const result = new Map<string, number[]>();
  for (const { id, category } of parsed.assignments) {
    if (!categorySet.has(category)) continue; // guard against the model drifting off-list anyway
    const list = result.get(category) ?? [];
    list.push(id);
    result.set(category, list);
  }
  return result;
}
