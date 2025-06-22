// src/providers/openai.ts
import {
  GenerateParams,
  GenerateResult,
  Message,
  ContentPart,
  TextPart,
  ImagePart,
  ToolCallPart,
  ToolResultPart,
  ProviderRequest,
  ProcessedStreamChunk,
  OnBeforeCallParams,
  OnMessageParams,
  OnErrorParams,
  OnFinishParams,
  Usage,
  GenerateResultStreaming,
  Role
} from '../types';
import { Provider, ProviderOptions } from './types';
import fetch, { Response } from 'node-fetch'; // Assuming node-fetch for Node.js environment
import { Readable } from 'stream'; // For Node.js stream handling

export interface OpenAIProviderOptions extends ProviderOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultOpenAIParams?: Record<string, any>; // To set default temperature, max_tokens etc.
}

// Helper to map our message format to OpenAI's format
const mapToOpenAIMessages = (messages: Message[], systemPrompt?: string): any[] => {
  const openAIMessages: any[] = [];
  if (systemPrompt) {
    openAIMessages.push({ role: 'system', content: systemPrompt });
  }
  messages.forEach(msg => {
    const role = msg.role === 'tool' ? 'tool' : msg.role; // OpenAI uses 'tool' for tool results
    if (typeof msg.content === 'string') {
      const openAIMsg: any = { role, content: msg.content };
      if (msg.role === 'tool' && msg.toolCallId) {
        openAIMsg.tool_call_id = msg.toolCallId;
      }
      openAIMessages.push(openAIMsg);
    } else {
      // Handle multimodal content or structured content parts
      const contentParts: any[] = [];
      msg.content.forEach(part => {
        if (part.type === 'text') {
          contentParts.push({ type: 'text', text: (part as TextPart).text });
        } else if (part.type === 'image') {
          const imagePart = part as ImagePart;
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${imagePart.mediaType};base64,${imagePart.data}`,
            },
          });
        } else if (part.type === 'tool_result' && msg.role === 'tool') {
            // This case for tool results should be handled carefully.
            // OpenAI expects role: 'tool', tool_call_id, and content (string result)
            // If part.content is not a string, it needs to be stringified.
            const toolResultPart = part as ToolResultPart;
             openAIMessages.push({ // Adding directly as it's a distinct message
                role: 'tool',
                tool_call_id: toolResultPart.toolUseId,
                content: typeof toolResultPart.content === 'string' ? toolResultPart.content : JSON.stringify(toolResultPart.content),
             });
             return; // Skip adding to contentParts as it's a separate message
        }
        // ToolCallPart is usually from assistant, not user/tool message content directly this way
      });
      // Only add if contentParts were actually populated (e.g. not exclusively tool_result)
      if (contentParts.length > 0) {
        openAIMessages.push({ role, content: contentParts });
      } else if (msg.role !== 'tool') { // if it was a tool role and no content parts, it was handled above
        // if it's a user/assistant message with no valid content parts (e.g. only tool_call if that was modeled this way)
        // this might indicate an issue or a need to represent empty messages if allowed by OpenAI
        openAIMessages.push({ role, content: "" }); // Default to empty content if nothing else, review if this is valid
      }
    }
  });
  return openAIMessages;
};

export class OpenAIProvider implements Provider {
  private options: OpenAIProviderOptions;
  private CAPI_BASE_URL = 'https://api.openai.com/v1';

  constructor(options: OpenAIProviderOptions) {
    this.options = {
      baseUrl: this.CAPI_BASE_URL,
      ...options,
    };
    if (!this.options.apiKey) {
      throw new Error('OpenAI API key is required.');
    }
  }

  async request(params: GenerateParams): Promise<GenerateResult> {
    const { modelId, messages, systemPrompt, stream, onBeforeCall, onMessage, onError, onFinish, providerOptions: requestProviderOptions } = params;

    const apiUrl = `${this.options.baseUrl}/chat/completions`;
    let openAIMessages;
    try {
        openAIMessages = mapToOpenAIMessages(messages, systemPrompt);
    } catch (e) {
        const err = new Error(`Error mapping messages to OpenAI format: ${(e as Error).message}`);
        if (onError) await onError({error: err, rawError: e, timestamp: new Date() });
        throw err;
    }


    const requestBody: Record<string, any> = {
      model: modelId,
      messages: openAIMessages,
      stream: stream ?? false,
      ...(this.options.defaultOpenAIParams || {}), // Provider-level defaults
      ...(requestProviderOptions || {}),          // Request-specific overrides
    };
    // Ensure stream:false is not overridden by defaultOpenAIParams if stream is explicitly true
    if (stream === true) {
        requestBody.stream = true;
    }


    if (onBeforeCall) {
      try {
        await onBeforeCall({ request: requestBody, timestamp: new Date() });
      } catch (e) {
        console.error("Error in onBeforeCall:", e);
        // If onBeforeCall is critical and fails, we might throw or use onError
        if (onError) await onError({error: e instanceof Error ? e : new Error(String(e)), rawError: e, timestamp: new Date()});
        throw e; // Rethrow to stop execution
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.options.apiKey}`,
    };
    if (this.options.organization) {
        headers['OpenAI-Organization'] = this.options.organization;
    }

    try {
      if (!stream) {
        // Non-streaming logic (mostly unchanged from previous step)
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody),
        });

        const responseText = await response.text(); // Get text first for better error reporting
        if (!response.ok) {
          let errorBody;
          try {
            errorBody = JSON.parse(responseText);
          } catch (e) {
            errorBody = { message: response.statusText, details: responseText };
          }
          const error = new Error(`OpenAI API Error: ${response.status} ${errorBody.error?.message || errorBody.message}`);
          if (onError) {
            await onError({ error, rawError: errorBody, timestamp: new Date() });
          }
          return { response: null, usage: null, stopReason: 'error' };
        }

        const responseData = JSON.parse(responseText);

        const assistantMessageContent = responseData.choices[0]?.message?.content;
        const finalMessage: Message = {
            role: 'assistant',
            content: assistantMessageContent || '',
            toolCalls: responseData.choices[0]?.message?.tool_calls
        };

        const usage: Usage = {
          inputTokens: responseData.usage?.prompt_tokens || 0,
          outputTokens: responseData.usage?.completion_tokens || 0,
          totalTokens: responseData.usage?.total_tokens || 0,
        };

        if (onMessage) {
          await onMessage({
            chunk: { type: 'stop', data: finalMessage },
            rawChunk: responseData,
            timestamp: new Date(),
          });
        }

        if (onFinish) {
          await onFinish({
            finalResponse: finalMessage,
            usage: usage,
            stopReason: responseData.choices[0]?.finish_reason || null,
            timestamp: new Date(),
            rawResponse: responseData,
          });
        }

        return {
          response: finalMessage,
          usage: usage,
          stopReason: responseData.choices[0]?.finish_reason,
        };

      } else {
        // Streaming Logic
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ message: response.statusText }));
          const error = new Error(`OpenAI API Error (streaming): ${response.status} ${errorBody.error?.message || errorBody.message}`);
          if (onError) {
            await onError({ error, rawError: errorBody, timestamp: new Date() });
          }
          throw error; // For streaming, throw to signal failure to establish stream
        }

        let aggregatedContent = "";
        let aggregatedToolCalls: any[] = [];
        let finalStopReason: string | null = null;
        let finalUsage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }; // Initialize usage

        // Helper function to process SSE chunks
        const processChunk = async (value: Uint8Array | undefined): Promise<void> => {
          if (value === undefined) return; // Stream finished
          const chunkStr = new TextDecoder().decode(value);
          const lines = chunkStr.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6);
              if (dataStr === '[DONE]') {
                // Stream is done
                return;
              }
              try {
                const chunkData = JSON.parse(dataStr);
                if (onMessage) {
                  let processedType: ProcessedStreamChunk['type'] = 'other';
                  let messageData: any = chunkData;

                  const delta = chunkData.choices?.[0]?.delta;
                  if (delta?.content) {
                    processedType = 'text_delta';
                    messageData = delta.content;
                    aggregatedContent += delta.content;
                  } else if (delta?.tool_calls) {
                    // Handle tool call deltas (can be partial)
                    // For simplicity, we'll send the delta and let user aggregate
                    // A more robust solution would aggregate tool calls here.
                    processedType = 'tool_call_delta';
                    messageData = delta.tool_calls;
                     delta.tool_calls.forEach((tc_delta: any) => {
                        if (tc_delta.index >= aggregatedToolCalls.length) {
                            aggregatedToolCalls.push({ id: tc_delta.id, type: 'function', function: { name: tc_delta.function?.name || "", arguments: tc_delta.function?.arguments || "" } });
                        } else {
                            const existingTc = aggregatedToolCalls[tc_delta.index];
                            if (tc_delta.function?.name) existingTc.function.name += tc_delta.function.name;
                            if (tc_delta.function?.arguments) existingTc.function.arguments += tc_delta.function.arguments;
                        }
                    });

                  }

                  await onMessage({
                    chunk: { type: processedType, data: messageData },
                    rawChunk: chunkData,
                    timestamp: new Date(),
                  });
                }
                if (chunkData.choices?.[0]?.finish_reason) {
                  finalStopReason = chunkData.choices?.[0]?.finish_reason;
                }
                // OpenAI streaming responses might not include usage per chunk.
                // It's often in a final non-streaming response or x-headers if not streaming.
                // For now, we'll rely on a possible final [DONE] message or separate call if needed.
                // Or, if the API sends usage in the last event before [DONE]
                 if (chunkData.usage) { // Check if usage is in the chunk (some models/endpoints might do this)
                    finalUsage = {
                        inputTokens: chunkData.usage.prompt_tokens || finalUsage.inputTokens,
                        outputTokens: chunkData.usage.completion_tokens || finalUsage.outputTokens,
                        totalTokens: chunkData.usage.total_tokens || finalUsage.totalTokens,
                    };
                 }


              } catch (e) {
                console.error('Error parsing stream chunk:', e, 'Chunk:', dataStr);
                if (onError) await onError({ error: e instanceof Error ? e : new Error(String(e)), rawError: dataStr, timestamp: new Date() });
              }
            }
          }
        };

        const reader = (response.body as unknown as Readable).getReader();
        const textStream = new ReadableStream<string>({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  break;
                }
                await processChunk(value); // Process the raw Uint8Array chunk
                // Extract and enqueue text delta for textStream
                const chunkStr = new TextDecoder().decode(value);
                const lines = chunkStr.split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6);
                        if (dataStr === '[DONE]') {
                            controller.close();
                            return;
                        }
                        try {
                            const parsed = JSON.parse(dataStr);
                            const textDelta = parsed.choices?.[0]?.delta?.content;
                            if (textDelta) {
                                controller.enqueue(textDelta);
                            }
                        } catch (e) { /* Ignore parse errors for non-text delta parts */ }
                    }
                }
              }
            } catch (error) {
              controller.error(error);
              if (onError) await onError({ error: error instanceof Error ? error : new Error(String(error)), rawError: error, timestamp: new Date() });
            } finally {
              if (!controller.desiredSize === null || controller.desiredSize! <= 0) { // Check if controller is closed before trying to close again
                 // controller might be closed by [DONE]
              } else {
                  try { controller.close(); } catch(e) { /* already closed */ }
              }
              reader.releaseLock();

              // After stream is fully processed
              const finalMessage: Message = {
                role: 'assistant' as Role,
                content: aggregatedContent,
                toolCalls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
              };

              if (onFinish) {
                await onFinish({
                  finalResponse: finalMessage,
                  usage: finalUsage, // This might be incomplete if not sent by OpenAI in stream
                  stopReason: finalStopReason,
                  timestamp: new Date(),
                  rawResponse: null, // No single raw response for stream end, maybe last chunk?
                });
              }
            }
          }
        });

        // Return GenerateResultStreaming
        const result: GenerateResultStreaming = {
            textStream: textStream as unknown as AsyncIterable<string>, // Cast for now
            finalResponse: async () => ({
                role: 'assistant' as Role,
                content: aggregatedContent,
                toolCalls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
            }),
            usage: async () => finalUsage, // This might be incomplete
            stopReason: async () => finalStopReason,
        };
        return result;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (onError) {
        await onError({ error: err, rawError: error, timestamp: new Date() });
      }
      if (!stream) {
        return { response: null, usage: null, stopReason: 'error' };
      } else {
        throw err;
      }
    }
  }
}
