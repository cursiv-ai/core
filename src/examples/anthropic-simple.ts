// src/examples/anthropic-simple.ts
import { generate, AnthropicProvider, Message } from '../index';
import * as dotenv from 'dotenv';

dotenv.config(); // .env file should have ANTHROPIC_API_KEY

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not found in .env file");
    return;
  }

  const provider = new AnthropicProvider({
    apiKey,
    // version: "2023-06-01" // Optional: defaults in provider
  });

  const messages: Message[] = [
    { role: 'user', content: "Hello, Anthropic! Write a short poem about coding." }
  ];

  console.log("--- Anthropic Non-Streaming Example ---");

  try {
    const result = await generate({
      provider,
      modelId: 'claude-3-haiku-20240307', // Or other claude model
      messages,
      stream: false,
      // Anthropic requires max_tokens, let's add it via providerOptions
      providerOptions: {
        max_tokens: 1024, // Overriding default in provider if any, or setting if not.
        // defaultAnthropicParams in provider constructor is another way for general defaults.
      },
      onBeforeCall: async (params) => {
        console.log('[onBeforeCall] Request Payload:', JSON.stringify(params.request, null, 2));
        console.log('[onBeforeCall] Timestamp:', params.timestamp);
      },
      onMessage: async (params) => {
        console.log('[onMessage] Chunk Type:', params.chunk.type);
        console.log('[onMessage] Data:', JSON.stringify(params.chunk.data, null, 2));
        console.log('[onMessage] Timestamp:', params.timestamp);
      },
      onError: async (params) => {
        console.error('[onError] Error:', params.error.message);
        if (params.rawError) {
          console.error('[onError] Raw Error:', JSON.stringify(params.rawError, null, 2));
        }
        console.error('[onError] Timestamp:', params.timestamp);
      },
      onFinish: async (params) => {
        console.log('[onFinish] Final Response:', JSON.stringify(params.finalResponse, null, 2));
        console.log('[onFinish] Usage:', JSON.stringify(params.usage, null, 2));
        console.log('[onFinish] Stop Reason:', params.stopReason);
        console.log('[onFinish] Timestamp:', params.timestamp);
      }
    });

    if (result && !result.stream) {
      console.log("\n--- Final Result Object ---");
      console.log("Response Message:", JSON.stringify(result.response, null, 2));
      console.log("Usage:", JSON.stringify(result.usage, null, 2));
      console.log("Stop Reason:", result.stopReason);
    }

  } catch (error) {
    console.error("Failed to run Anthropic simple example:", error);
  }
}

main();
