import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'edge'; // Enforces global distributed execution across CDN nodes

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'MOCK_KEY_GUARDRAIL',
});

export async function POST(request: Request) {
  try {
    const { userPrompt, conversationHistory } = await request.json();

    if (!userPrompt) {
      return NextResponse.json({ error: "Missing string payload parameters" }, { status: 400 });
    }

    // Step 1: Mock Context Vector Injection Loop (RAG Phase placeholder)
    const injectedContext = "[Context Injection: User portfolio target version is Next.js 15]";

    // Step 2: Establish connection stream to the cloud intelligence engine
    const completionStream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are an AI core agent module. Rely heavily on contextual boundaries: ${injectedContext}` },
        ...conversationHistory,
        { role: 'user', content: userPrompt }
      ],
      stream: true, // Enables immediate partial client rendering execution loop
    });

    // Step 3: Transform completion stream securely to browser stream interface
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of completionStream) {
          const content = chunk.choices[0]?.delta?.content || '';
          controller.enqueue(encoder.encode(content));
        }
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });

  } catch (error: any) {
    // Failover Loop: Gracefully catch timeouts or rate spikes
    return NextResponse.json({ 
      error: "AI Gateway pipeline broken.", 
      details: error?.message || "Internal network error" 
    }, { status: 500 });
  }
}