// src/providers/anthropic.ts
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
  Role,
  GenerateResultStreaming
} from '../types';
import { Provider, ProviderOptions } from './types';
import fetch, { Response } from 'node-fetch'; // Assuming node-fetch
import { Readable } from 'stream'; // For Node.js stream handling

export interface AnthropicProviderOptions extends ProviderOptions {
  apiKey: string;
  baseUrl?: string;
  version?: string; // e.g., "2023-06-01"
  defaultAnthropicParams?: Record<string, any>;
  ['anthropic-beta']?: string; // For beta features
}

// Helper to map our message format to Anthropic's format
const mapToAnthropicMessages = (messages: Message[]): any[] => {
  return messages.map(msg => {
    let content: any;
    const role = msg.role === 'tool' ? 'user' : msg.role; // Map 'tool' (our result) to 'user' for Anthropic

    if (typeof msg.content === 'string') {
      // If role is 'user' (originally 'tool'), and content is simple string, it's a tool result content
      if (role === 'user' && msg.role === 'tool') {
         content = [{ type: 'tool_result', tool_use_id: msg.toolCallId!, content: msg.content }];
      } else {
         content = msg.content;
      }
    } else {
      content = msg.content.map(part => {
        if (part.type === 'text') {
          return { type: 'text', text: (part as TextPart).text };
        } else if (part.type === 'image') {
          const imagePart = part as ImagePart;
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imagePart.mediaType,
              data: imagePart.data,
            },
          };
        } else if (part.type === 'tool_result') {
            const toolResultPart = part as ToolResultPart;
            // Anthropic's tool_result content can be a string or array of content blocks.
            // If our ToolResultPart.content is a string, we can pass it directly.
            // If it's an array (intended for complex output), we might need to wrap it, e.g., as text.
            let toolContent: any = toolResultPart.content;
            if (Array.isArray(toolResultPart.content)) {
                // Convert our ContentPart[] to Anthropic's expected format if necessary
                // For simplicity, let's assume if it's an array, it's an array of TextPart-like structures for now
                // or that the user has formatted it correctly for Anthropic.
                // A robust way would be to recursively map these parts if they are our ContentPart.
                // Simplified: if it's an array, pass as is, assuming user formatted for Anthropic or it's simple text blocks.
                 toolContent = toolResultPart.content.map(c => (typeof c === 'string' ? c : {type: 'text', text: (c as TextPart).text}));
            }

            return {
                type: 'tool_result',
                tool_use_id: toolResultPart.toolUseId,
                content: toolContent,
                is_error: toolResultPart.isError
            };
        }
        return null;
      }).filter(p => p !== null);
    }
    return { role, content };
  });
};

export class AnthropicProvider implements Provider {
  private options: AnthropicProviderOptions;
  private CAPI_BASE_URL = 'https://api.anthropic.com/v1';
  private DEFAULT_VERSION = '2023-06-01';

  constructor(options: AnthropicProviderOptions) {
    this.options = {
      baseUrl: this.CAPI_BASE_URL,
      version: this.DEFAULT_VERSION,
      ...options,
    };
    if (!this.options.apiKey) {
      throw new Error('Anthropic API key is required.');
    }
  }

  async request(params: GenerateParams): Promise<GenerateResult> {
    const { modelId, messages, systemPrompt, stream, onBeforeCall, onMessage, onError, onFinish, providerOptions: requestProviderOptions } = params;

    const apiUrl = `${this.options.baseUrl}/messages`;
    let anthropicMessages;
    try {
        anthropicMessages = mapToAnthropicMessages(messages);
    } catch (e) {
        const err = new Error(`Error mapping messages to Anthropic format: ${(e as Error).message}`);
        if (onError) await onError({error: err, rawError: e, timestamp: new Date() });
        throw err;
    }

    const requestBody: Record<string, any> = {
      model: modelId,
      messages: anthropicMessages,
      stream: stream ?? false,
      max_tokens: 4096, // Anthropic requires max_tokens
      ...(this.options.defaultAnthropicParams || {}),
      ...(requestProviderOptions || {}),
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }
     if (stream === true) { // Ensure stream parameter is correctly set
        requestBody.stream = true;
    }

    if (onBeforeCall) {
      try {
        await onBeforeCall({ request: requestBody, timestamp: new Date() });
      } catch (e) {
        console.error("Error in onBeforeCall:", e);
        if (onError) await onError({error: e instanceof Error ? e : new Error(String(e)), rawError: e, timestamp: new Date()});
        throw e;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.options.apiKey,
      'anthropic-version': this.options.version!,
    };
    if (this.options['anthropic-beta']) {
        headers['anthropic-beta'] = this.options['anthropic-beta'];
    }

    try {
      if (!stream) {
        // Non-streaming logic (mostly unchanged)
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody),
        });

        const responseText = await response.text();
        if (!response.ok) {
          let errorBody;
          try { errorBody = JSON.parse(responseText); }
          catch (e) { errorBody = { message: response.statusText, details: responseText }; }
          const errMsg = errorBody.error?.message || errorBody.message || response.statusText;
          const errType = errorBody.error?.type || errorBody.type || 'unknown_error';
          const error = new Error(`Anthropic API Error: ${response.status} ${errType}: ${errMsg}`);
          if (onError) await onError({ error, rawError: errorBody, timestamp: new Date() });
          return { response: null, usage: null, stopReason: 'error' };
        }

        const responseData = JSON.parse(responseText);
        const assistantContentParts: ContentPart[] = (responseData.content || []).map((block: any): ContentPart | null => {
          if (block.type === 'text') return { type: 'text', text: block.text };
          if (block.type === 'tool_use') return { type: 'tool_call', id: block.id, name: block.name, input: block.input };
          return null;
        }).filter((p: ContentPart | null) => p !== null) as ContentPart[];

        const finalMessage: Message = { role: 'assistant', content: assistantContentParts };
        const usage: Usage = {
          inputTokens: responseData.usage?.input_tokens || 0,
          outputTokens: responseData.usage?.output_tokens || 0,
          totalTokens: (responseData.usage?.input_tokens || 0) + (responseData.usage?.output_tokens || 0),
        };

        if (onMessage) await onMessage({ chunk: { type: 'stop', data: finalMessage }, rawChunk: responseData, timestamp: new Date() });
        if (onFinish) await onFinish({ finalResponse: finalMessage, usage: usage, stopReason: responseData.stop_reason || null, timestamp: new Date(), rawResponse: responseData });

        return { response: finalMessage, usage: usage, stopReason: responseData.stop_reason };

      } else {
        // Streaming Logic
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ message: response.statusText }));
          const error = new Error(`Anthropic API Error (streaming): ${response.status} ${errorBody.error?.type || errorBody.type}: ${errorBody.error?.message || errorBody.message}`);
          if (onError) await onError({ error, rawError: errorBody, timestamp: new Date() });
          throw error;
        }

        let aggregatedTextContent = "";
        const currentToolCalls: Record<string, { id: string, name: string, inputChunks: string[] }> = {};
        const finalToolCalls: ToolCallPart[] = [];
        let finalMessageContentBlocks: ContentPart[] = [];

        let currentMessage: Partial<Message> = { role: 'assistant', content: [] };
        let currentUsage: Usage = { inputTokens: 0, outputTokens: 0 };
        let currentStopReason: string | null = null;


        const reader = (response.body as unknown as Readable).getReader();
        const textDecoder = new TextDecoder();

        const streamController = {
            _controller: null as ReadableStreamDefaultController<string> | null,
            enqueue(chunk: string) { if(this._controller) this._controller.enqueue(chunk); },
            close() { if(this._controller) { try { this._controller.close(); } catch(e){/* already closed */} } },
            error(e: any) { if(this._controller) this._controller.error(e); }
        };

        const textStream = new ReadableStream<string>({
          async start(controller) {
            streamController._controller = controller;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunkStr = textDecoder.decode(value, { stream: true });
                const eventLines = chunkStr.split('\n\n').filter(line => line.trim() !== '');

                for (const eventLine of eventLines) {
                  const lines = eventLine.split('\n');
                  let eventName: string | null = null;
                  let dataStr = "";

                  for (const line of lines) {
                    if (line.startsWith('event: ')) eventName = line.substring(7).trim();
                    else if (line.startsWith('data: ')) dataStr += line.substring(6);
                  }

                  if (!eventName || !dataStr) continue;

                  try {
                    const eventData = JSON.parse(dataStr);
                    let processedChunkType: ProcessedStreamChunk['type'] = 'other';
                    let processedChunkData: any = eventData;

                    if (eventName === 'message_start') {
                      currentUsage.inputTokens = eventData.message?.usage?.input_tokens || 0;
                       if (onMessage) await onMessage({ chunk: { type: 'other', data: { eventName, eventData } }, rawChunk: eventData, timestamp: new Date() });
                    } else if (eventName === 'content_block_start') {
                       if (onMessage) await onMessage({ chunk: { type: 'other', data: { eventName, eventData } }, rawChunk: eventData, timestamp: new Date() });
                    } else if (eventName === 'content_block_delta') {
                      const delta = eventData.delta;
                      if (delta.type === 'text_delta') {
                        processedChunkType = 'text_delta';
                        processedChunkData = delta.text;
                        aggregatedTextContent += delta.text;
                        streamController.enqueue(delta.text);
                      } else if (delta.type === 'input_json_delta') {
                        // This is for tool_use input.
                        processedChunkType = 'tool_call_delta'; // Or a more specific type
                        processedChunkData = { tool_use_id: eventData.index, /* or actual id if available */ partial_json: delta.partial_json };

                        // Simple aggregation for input_json_delta - needs robust parsing for actual tool use
                        const toolIndex = eventData.index; // Assuming index corresponds to a tool_use block
                        // This part requires knowing the ID of the tool_use block from a content_block_start event with type tool_use
                        // For now, we'll pass it through onMessage. Actual tool call object construction is complex.
                      }
                       if (onMessage) await onMessage({ chunk: { type: processedChunkType, data: processedChunkData }, rawChunk: eventData, timestamp: new Date() });
                    } else if (eventName === 'content_block_stop') {
                        // Potentially finalize a tool_use block here if we were aggregating its input_json_delta
                         if (onMessage) await onMessage({ chunk: { type: 'other', data: { eventName, eventData } }, rawChunk: eventData, timestamp: new Date() });
                    } else if (eventName === 'message_delta') {
                      currentUsage.outputTokens = eventData.usage?.output_tokens || currentUsage.outputTokens;
                      if (eventData.delta?.stop_reason) currentStopReason = eventData.delta.stop_reason;
                       if (onMessage) await onMessage({ chunk: { type: 'other', data: { eventName, eventData } }, rawChunk: eventData, timestamp: new Date() });
                    } else if (eventName === 'message_stop') {
                      // This is the definitive end of the message stream
                       if (onMessage) await onMessage({ chunk: { type: 'stop', data: { eventName, eventData } }, rawChunk: eventData, timestamp: new Date() });
                      break; // Exit the inner loop for eventLines
                    } else if (eventName === 'ping') {
                      // Ignore ping or handle if necessary
                    } else if (eventName === 'error') {
                        const err = new Error(`Anthropic API Stream Error: ${eventData.error?.type} ${eventData.error?.message}`);
                        if (onError) await onError({ error: err, rawError: eventData.error, timestamp: new Date() });
                        streamController.error(err); // Propagate error to the stream consumer
                        return; // Stop processing further
                    }
                  } catch (e) {
                    console.error('Error parsing Anthropic stream data:', e, 'Data:', dataStr);
                    if (onError) await onError({ error: e instanceof Error ? e : new Error(String(e)), rawError: dataStr, timestamp: new Date() });
                  }
                } // end for eventLine
                if (eventName === 'message_stop') break; // Exit outer while loop
              } // end while(true)
            } catch (error) {
              streamController.error(error);
              if (onError) await onError({ error: error instanceof Error ? error : new Error(String(error)), rawError: error, timestamp: new Date() });
            } finally {
              streamController.close();
              reader.releaseLock();

              // Construct final aggregated message (simplified for now)
              // A more robust implementation would build ContentPart[] based on content_block_start/delta/stop events
              finalMessageContentBlocks.push({type: 'text', text: aggregatedTextContent});
              // TODO: Add aggregated tool calls to finalMessageContentBlocks if any

              const finalResponseMsg: Message = {
                role: 'assistant',
                content: finalMessageContentBlocks,
              };
              currentUsage.totalTokens = currentUsage.inputTokens + currentUsage.outputTokens;

              if (onFinish) {
                await onFinish({
                  finalResponse: finalResponseMsg,
                  usage: currentUsage,
                  stopReason: currentStopReason,
                  timestamp: new Date(),
                  rawResponse: null, // No single raw response for stream end
                });
              }
            }
          }
        });

        const result: GenerateResultStreaming = {
            textStream: textStream as unknown as AsyncIterable<string>, // Cast
            finalResponse: async () => {
                // This needs to be more robust, using the fully aggregated content
                 finalMessageContentBlocks = [];
                 if(aggregatedTextContent) finalMessageContentBlocks.push({type: 'text', text: aggregatedTextContent});
                 // TODO: Add fully aggregated tool calls
                return { role: 'assistant', content: finalMessageContentBlocks };
            },
            usage: async () => ({...currentUsage, totalTokens: currentUsage.inputTokens + currentUsage.outputTokens }),
            stopReason: async () => currentStopReason,
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
