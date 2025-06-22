// src/examples/openai-multimodal.ts
import { generate, OpenAIProvider, Message, ContentPart } from '../index';
import * as dotenv from 'dotenv';

dotenv.config();

// A tiny 1x1 red pixel PNG, base64 encoded
const tinyRedDotBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not found in .env file");
    return;
  }

  // Ensure you use a model that supports vision, e.g., gpt-4o or gpt-4-vision-preview
  // Using gpt-4o as it's the latest and recommended.
  const modelId = 'gpt-4o';

  const provider = new OpenAIProvider({ apiKey });

  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: "What is in this image? Describe it briefly." },
        {
          type: 'image',
          mediaType: 'image/png', // Matching the tinyRedDotBase64
          data: tinyRedDotBase64
        }
      ]
    }
  ];

  console.log(`--- OpenAI Multimodal Example (Model: ${modelId}) ---`);

  try {
    const result = await generate({
      provider,
      modelId,
      messages,
      stream: false, // Keeping it non-streaming for simplicity of example output
      providerOptions: {
        max_tokens: 300, // OpenAI specific parameter
      },
      onBeforeCall: async (params) => {
        console.log('[onBeforeCall] Request Model:', JSON.stringify(params.request.model));
        // console.log('[onBeforeCall] Request Messages:', JSON.stringify(params.request.messages, null, 2)); // Can be verbose
      },
      onMessage: async (params) => {
        console.log('[onMessage] Data:', JSON.stringify(params.chunk.data, null, 2));
      },
      onError: async (params) => {
        console.error('[onError] Error:', params.error.message);
        if (params.rawError) {
          console.error('[onError] Raw Error:', JSON.stringify(params.rawError, null, 2));
        }
      },
      onFinish: async (params) => {
        console.log('[onFinish] Final Response:', JSON.stringify(params.finalResponse, null, 2));
        console.log('[onFinish] Usage:', JSON.stringify(params.usage, null, 2));
        console.log('[onFinish] Stop Reason:', params.stopReason);
      }
    });

    if (result && !result.stream) {
      console.log("\n--- Final Result Object ---");
      console.log("Response Message Content:", JSON.stringify(result.response?.content, null, 2));
    }

  } catch (error) {
    console.error("Failed to run OpenAI multimodal example:", error);
  }
}

main();
