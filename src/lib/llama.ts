import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Local Llama 3 fallback loop.
 *
 * When the primary cloud provider (OpenAI) fails — rate limits, timeouts, or
 * outage — the gateway degrades gracefully to a locally hosted Llama 3 model.
 * The local model is exposed through an OpenAI-compatible endpoint (e.g. Ollama
 * at http://localhost:11434/v1), so the same streaming contract is preserved.
 */

const LLAMA_BASE_URL = process.env.LLAMA_BASE_URL || 'http://localhost:11434/v1';
const LLAMA_MODEL = process.env.LLAMA_MODEL || 'llama3';

let llamaClient: OpenAI | null = null;

function getLlama(): OpenAI {
  if (!llamaClient) {
    llamaClient = new OpenAI({
      baseURL: LLAMA_BASE_URL,
      // Local servers don't require a real key, but the SDK insists on a value.
      apiKey: process.env.LLAMA_API_KEY || 'ollama',
    });
  }
  return llamaClient;
}

/**
 * Opens a streaming completion against the local Llama 3 model.
 */
export async function streamLlamaFallback(messages: ChatCompletionMessageParam[]) {
  return getLlama().chat.completions.create({
    model: LLAMA_MODEL,
    messages,
    stream: true,
  });
}
