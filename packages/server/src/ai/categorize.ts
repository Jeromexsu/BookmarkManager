import { z } from "zod";
import { getClient } from "./tagging.js";

export interface CandidateBookmark {
  id: number;
  title: string;
  tags: string[];
}

// Two-pass design, not one giant call: the previous single-call approach made the model echo
// back every bookmark id in one response, which is what made it slow (and an all-or-nothing
// failure) at a few hundred bookmarks — generation time scales with output size, not input
// size. Splitting "what are the buckets" from "which bucket does each one go in" keeps each
// call's output small: the taxonomy call outputs a handful of names, and each classify-chunk
// call only has to enumerate its own chunk's ids, not the whole set.

const taxonomyResultSchema = z.object({
  categories: z.array(z.string()),
});

const TAXONOMY_TIMEOUT_MS = 60_000;

// Existing categories are passed in and the model is told to reuse them — this call proposes
// new categories only for topics that don't already have a home, not a from-scratch taxonomy.
export async function pickCategoryTaxonomy(items: CandidateBookmark[], existingCategories: string[]): Promise<string[]> {
  const response = await getClient().chat.completions.create(
    {
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Given a list of bookmarks (title + tags) and the categories that already exist, " +
            "propose the full set of categories needed to cover this list — big topic areas a " +
            'person would use to bundle up many bookmarks, like "travel", "news", or "computer ' +
            'science" (NOT narrow/specific topics like "react hooks" or "paris hotels" — those ' +
            "are tags, not categories). Reuse an existing category name whenever it fits — only " +
            "add a new one for a topic none of the existing categories cover. Aim for roughly " +
            "5-15 categories total that together cover the whole list. Respond with strict JSON " +
            '{"categories": string[]}. No prose outside the JSON.',
        },
        {
          role: "user",
          content: JSON.stringify({
            existingCategories,
            bookmarks: items.map((i) => ({ title: i.title, tags: i.tags })),
          }),
        },
      ],
      stream: false,
    },
    { timeout: TAXONOMY_TIMEOUT_MS }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  return taxonomyResultSchema.parse(JSON.parse(raw)).categories;
}

const classifyChunkResultSchema = z.object({
  assignments: z.array(z.object({ id: z.number(), category: z.string() })),
});

const CHUNK_TIMEOUT_MS = 60_000;

// Classifies one chunk against an already-decided, fixed category list — no room for the model
// to invent new categories here, that already happened in pickCategoryTaxonomy.
export async function classifyChunk(items: CandidateBookmark[], categoryNames: string[]): Promise<Map<string, number[]>> {
  const response = await getClient().chat.completions.create(
    {
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Assign each given bookmark to exactly one of the given categories, based on its " +
            'title and tags. Respond with strict JSON {"assignments": [{"id": number, ' +
            '"category": string}]} — one entry per bookmark id given, "category" must be exactly ' +
            "one of the provided category names, verbatim. No prose outside the JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({ categories: categoryNames, bookmarks: items }),
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
  const categorySet = new Set(categoryNames);
  const result = new Map<string, number[]>();
  for (const { id, category } of parsed.assignments) {
    if (!categorySet.has(category)) continue; // guard against the model drifting off-list anyway
    const list = result.get(category) ?? [];
    list.push(id);
    result.set(category, list);
  }
  return result;
}
