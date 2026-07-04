import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { retrieveContext } from '../../../lib/pinecone';
import { streamLlamaFallback } from '../../../lib/llama';

export const runtime = 'edge'; // Enforces global distributed execution across V8 isolate nodes

const PRIMARY_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildMessages(
  userPrompt: string,
  conversationHistory: ChatCompletionMessageParam[],
  context: string,
): ChatCompletionMessageParam[] {
  const systemContent = context
    ? `You are a context-aware AI agent. Answer using ONLY the retrieved context below when it is relevant; if it is insufficient, say so.\n\n--- Retrieved Context ---\n${context}\n--- End Context ---`
    : 'You are a context-aware AI agent. No external context was retrieved for this query; answer from general knowledge and note the lack of retrieved context.';

  return [
    { role: 'system', content: systemContent },
    ...conversationHistory,
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Transforms an OpenAI-style async completion stream into a browser-ready
 * Text Event Stream of raw token chunks.
 */
function toReadableStream(
  completionStream: AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of completionStream) {
          const content = chunk.choices[0]?.delta?.content ?? '';
          if (content) {
            controller.enqueue(encoder.encode(content));
          }
        }
      } catch (streamError) {
        controller.error(streamError);
        return;
      }
      controller.close();
    },
  });
}

export async function POST(request: Request) {
  let messages: ChatCompletionMessageParam[];

  try {
    const body = await request.json();
    const { userPrompt, conversationHistory } = body ?? {};

    if (typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid "userPrompt" string payload.' },
        { status: 400 },
      );
    }

    const history: ChatCompletionMessageParam[] = Array.isArray(conversationHistory)
      ? conversationHistory
      : [];

    // Step 1: Dynamic RAG — embed the prompt and pull nearest neighbours from Pinecone.
    let context = '';
    try {
      const retrieved = await retrieveContext(userPrompt);
      context = retrieved.context;
    } catch (retrievalError) {
      // Retrieval is best-effort; degrade to no-context rather than failing the request.
      console.error('Context retrieval failed, continuing without RAG context:', retrievalError);
    }

    messages = buildMessages(userPrompt, history, context);
  } catch (parseError: unknown) {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400 },
    );
  }

  // Step 2: Primary cloud inference (OpenAI) with a local Llama 3 fallback loop.
  try {
    const completionStream = await openai.chat.completions.create({
      model: PRIMARY_MODEL,
      messages,
      stream: true,
    });

    return new Response(toReadableStream(completionStream), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Inference-Source': 'openai',
      },
    });
  } catch (primaryError: unknown) {
    console.error('Primary OpenAI inference failed, engaging Llama 3 fallback:', primaryError);

    // Step 3: Fallback Loop — retry against the local Llama 3 model.
    try {
      const fallbackStream = await streamLlamaFallback(messages);

      return new Response(toReadableStream(fallbackStream), {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Inference-Source': 'llama3-fallback',
        },
      });
    } catch (fallbackError: unknown) {
      const details =
        fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback failure';
      return NextResponse.json(
        {
          error: 'AI Gateway pipeline failed: primary provider and Llama 3 fallback are both unavailable.',
          details,
        },
        { status: 502 },
      );
    }
  }
}
