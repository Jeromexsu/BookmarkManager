import { z } from "zod";
import { categoryPlanSchema, type CategoryPlan } from "@bookmark-manager/shared";
import { getClient } from "./tagging.js";

export interface CategorySample {
  // "Uncategorized" for the bucket of bookmarks with no category at all — included as just
  // another sample so the model can spot clusters worth turning into a new category.
  name: string;
  description: string | null;
  count: number;
  sampleTitles: string[];
  topTags: string[];
}

const PLAN_TIMEOUT_MS = 90_000;

// Loose shape for the raw model response — cross-checked against the real category names
// afterward, same "guard against the model drifting off-list" reasoning as classifyChunk.
const rawPlanSchema = z.object({
  add: z.array(z.object({ name: z.string(), description: z.string().default(""), reason: z.string().default("") })).default([]),
  rename: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string().default("") })).default([]),
  remove: z.array(z.object({ name: z.string(), reason: z.string().default("") })).default([]),
  describe: z.array(z.object({ name: z.string(), description: z.string(), reason: z.string().default("") })).default([]),
});

// Recommends changes to the taxonomy itself (add/rename/remove/describe) — distinct from
// classifyChunk in categorize.ts, which only assigns bookmarks into whatever categories already
// exist. Takes per-category *samples* (not the full corpus) so the prompt stays small regardless
// of how many bookmarks exist; samples are built by the caller (see categories.ts route).
export async function planCategoryList(samples: CategorySample[]): Promise<CategoryPlan> {
  const existingNames = new Set(samples.filter((s) => s.name !== "Uncategorized").map((s) => s.name));

  const response = await getClient().chat.completions.create(
    {
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You help reorganize a personal bookmark manager's category taxonomy. Categories are",
            "broad topic buckets (e.g. Coding, Travel, News) — never narrow tags.",
            "",
            "You're given every current category (with its description, bookmark count, a sample",
            "of bookmark titles, and its most common tags) plus the same sample for bookmarks that",
            'currently have no category at all (name: "Uncategorized"). Recommend a revised',
            "category list as strict JSON:",
            '{"add": [{"name": string, "description": string, "reason": string}],',
            ' "rename": [{"from": string, "to": string, "reason": string}],',
            ' "remove": [{"name": string, "reason": string}],',
            ' "describe": [{"name": string, "description": string, "reason": string}]}',
            "",
            "Rules:",
            "- Only propose a change when it's a real improvement — an empty plan for a list",
            "  that's already in good shape is a perfectly good answer.",
            '- "add" is for a brand-new category name, one not in the current list, to cover a',
            "  cluster you see in the Uncategorized sample (or a subset of an overly broad",
            "  existing category worth splitting out). Always include a short description.",
            '- "rename" changes an existing category\'s name — "from" must be one of the current',
            '  category names, exactly. "to" may be a brand-new name, or it may equal another',
            "  existing category's name, in which case the two merge (all of \"from\"'s bookmarks",
            '  end up under "to") — use this instead of "remove" whenever there\'s a good existing',
            "  home for a redundant or near-duplicate category, since remove uncategorizes them",
            "  instead.",
            '- "remove" deletes a category outright and its bookmarks become Uncategorized — only',
            "  for one that's genuinely redundant, unused, or too sparse to justify existing, and",
            "  has no better existing category to merge into.",
            '- "describe" adds or improves a description for a category that is NOT being',
            '  removed — "name" must be either an existing category name, or the "to" of a rename',
            '  above (never the "from" side, and never a name introduced by "add", which carries',
            "  its own description already).",
            "- Never propose an add/rename \"to\" that collides case-insensitively with a category",
            "  name you are not also removing or renaming away.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ categories: samples }),
        },
      ],
      stream: false,
    },
    { timeout: PLAN_TIMEOUT_MS }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  const parsed = rawPlanSchema.parse(JSON.parse(raw));

  const renameToNames = new Set(parsed.rename.map((r) => r.to));
  const addNames = new Set(parsed.add.map((a) => a.name));
  const describableNames = new Set([...existingNames, ...renameToNames, ...addNames]);

  const plan: CategoryPlan = {
    add: parsed.add.filter((a) => !existingNames.has(a.name)),
    rename: parsed.rename.filter((r) => existingNames.has(r.from) && r.from !== r.to),
    remove: parsed.remove.filter((r) => existingNames.has(r.name)),
    describe: parsed.describe.filter(
      (d) => describableNames.has(d.name) && !parsed.remove.some((r) => r.name === d.name)
    ),
  };

  return categoryPlanSchema.parse(plan);
}
