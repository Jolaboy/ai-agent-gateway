import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';

/**
 * Context-Aware retrieval layer.
 *
 * Implements the "Dynamic RAG" requirement: the incoming user prompt is embedded,
 * matched against a Pinecone vector index, and the top-k nearest documents are
 * assembled into a context window that is injected into the model system prompt.
 */

const PINECONE_INDEX = process.env.PINECONE_INDEX || 'agentic-chat-gateway';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

// Lazily-initialised singletons so the Edge worker reuses warm connections.
let pineconeClient: Pinecone | null = null;
let embedder: OpenAIEmbeddings | null = null;

function getPinecone(): Pinecone {
  if (!pineconeClient) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error('PINECONE_API_KEY is not configured');
    }
    pineconeClient = new Pinecone({ apiKey });
  }
  return pineconeClient;
}

function getEmbedder(): OpenAIEmbeddings {
  if (!embedder) {
    embedder = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: EMBEDDING_MODEL,
    });
  }
  return embedder;
}

export interface RetrievedContext {
  /** Concatenated text of the matched documents, ready for prompt injection. */
  context: string;
  /** Number of matches that contributed to the context window. */
  matchCount: number;
}

/**
 * Embeds the prompt and performs a vector-similarity lookup against Pinecone.
 *
 * @param prompt  The real-time user prompt.
 * @param topK    Dynamic context length: how many neighbours to retrieve.
 */
export async function retrieveContext(prompt: string, topK = 4): Promise<RetrievedContext> {
  const vector = await getEmbedder().embedQuery(prompt);

  const index = getPinecone().index(PINECONE_INDEX);
  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
  });

  const matches = result.matches ?? [];
  const passages = matches
    .map((match) => {
      const metadata = (match.metadata ?? {}) as Record<string, unknown>;
      const text = metadata.text ?? metadata.content ?? metadata.chunk;
      return typeof text === 'string' ? text.trim() : '';
    })
    .filter((text) => text.length > 0);

  return {
    context: passages.join('\n---\n'),
    matchCount: passages.length,
  };
}
