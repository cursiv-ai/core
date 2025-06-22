// src/examples/openai-streaming.ts
import { generate, OpenAIProvider, Message } from '../index';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not found in .env file");
    return;
  }

  const provider = new OpenAIProvider({ apiKey });

  const messages: Message[] = [
    { role: 'user', content: "Hello, OpenAI! Tell me a story about a brave little robot. Stream it." }
  ];

  console.log("--- OpenAI Streaming Example ---");
  let fullStory = "";

  try {
    const result = await generate({
      provider,
      modelId: 'gpt-3.5-turbo',
      messages,
      stream: true,
      providerOptions: {
        temperature: 0.7, // Example of passing OpenAI specific params
      },
      onBeforeCall: async (params) => {
        console.log('[onBeforeCall] Request Payload:', JSON.stringify(params.request.model, null, 2)); // Log only model for brevity
        // console.log('[onBeforeCall] Full Request:', JSON.stringify(params.request, null, 2));
      },
      onMessage: async (params) => {
        if (params.chunk.type === 'text_delta') {
          process.stdout.write(params.chunk.data); // Stream text to console
          fullStory += params.chunk.data;
        } else if (params.chunk.type !== 'stop') { // Avoid logging the final 'stop' type from non-streaming onMessage
             console.log(`\n[onMessage] Chunk Type: ${params.chunk.type}, Data: ${JSON.stringify(params.chunk.data).substring(0,100)}...`);
        }
      },
      onError: async (params) => {
        console.error('\n[onError] Error:', params.error.message);
        if (params.rawError) {
          // console.error('[onError] Raw Error:', JSON.stringify(params.rawError, null, 2));
        }
      },
      onFinish: async (params) => {
        console.log('\n[onFinish] Streaming complete.');
        console.log('[onFinish] Final Assembled Story (from onFinish):', params.finalResponse?.content);
        console.log('[onFinish] Usage (may be approximate for streaming):', JSON.stringify(params.usage, null, 2));
        console.log('[onFinish] Stop Reason:', params.stopReason);
      }
    });

    if (result && result.stream) { // Type guard for streaming result
      console.log("\n--- Consuming textStream ---");
      // The textStream can be consumed independently as well
      // For this example, onMessage already printed it.
      // We can also await the final aggregated details from the result object:

      // const finalResponse = await result.finalResponse();
      // console.log("\n--- Final Assembled Story (from result.finalResponse) ---");
      // console.log(finalResponse?.content);

      // const usage = await result.usage();
      // console.log("\n--- Usage (from result.usage) ---");
      // console.log(JSON.stringify(usage, null, 2));

      // const stopReason = await result.stopReason();
      // console.log("\n--- Stop Reason (from result.stopReason) ---");
      // console.log(stopReason);
    }

  } catch (error) {
    console.error("\nFailed to run OpenAI streaming example:", error);
  }
}

main();
