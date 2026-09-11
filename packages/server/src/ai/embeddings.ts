// Semantic search (roadmap step 2) needs an embedding provider, which is still being decided
// (local transformers.js vs. a hosted API). This interface isolates that decision: once chosen,
// implement it here and swap `getEmbeddingProvider`'s return value — no other code should change.

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

class NotConfiguredProvider implements EmbeddingProvider {
  async embed(): Promise<number[]> {
    throw new Error(
      "No embedding provider configured yet. Semantic search is not available until one is chosen " +
        "and wired up in packages/server/src/ai/embeddings.ts."
    );
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  return new NotConfiguredProvider();
}
