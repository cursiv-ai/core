// src/examples/openai-simple.ts
import { generate, OpenAIProvider, Message } from '../index'; // Adjust path based on actual output structure or use module name if linked
import * as dotenv from 'dotenv';

dotenv.config(); // Make sure to have a .env file with OPENAI_API_KEY

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not found in .env file");
    return;
  }

  const provider = new OpenAIProvider({ apiKey });

  const messages: Message[] = [
    { role: 'user', content: "Hello, OpenAI! Tell me a short joke." }
  ];

  console.log("--- OpenAI Non-Streaming Example ---");

  try {
    const result = await generate({
      provider,
      modelId: 'gpt-3.5-turbo', // Or any other model you have access to
      messages,
      stream: false,
      onBeforeCall: async (params) => {
        console.log('[onBeforeCall] Request Payload:', JSON.stringify(params.request, null, 2));
        console.log('[onBeforeCall] Timestamp:', params.timestamp);
      },
      onMessage: async (params) => {
        // For non-streaming, this is called once with the full message
        console.log('[onMessage] Chunk Type:', params.chunk.type);
        console.log('[onMessage] Data:', JSON.stringify(params.chunk.data, null, 2));
        if (params.rawChunk) {
          // console.log('[onMessage] Raw Chunk:', JSON.stringify(params.rawChunk, null, 2));
        }
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
        // if (params.rawResponse) {
        //   console.log('[onFinish] Raw Response:', JSON.stringify(params.rawResponse, null, 2));
        // }
      }
    });

    if (result && !result.stream) { // Type guard for non-streaming result
      console.log("\n--- Final Result Object ---");
      console.log("Response Message:", JSON.stringify(result.response, null, 2));
      console.log("Usage:", JSON.stringify(result.usage, null, 2));
      console.log("Stop Reason:", result.stopReason);
    }

  } catch (error) {
    console.error("Failed to run OpenAI simple example:", error);
  }
}

main();
