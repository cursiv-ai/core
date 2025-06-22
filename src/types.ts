// src/types.ts
import { Provider } from './providers/types'; // Import Provider

export type Role = 'user' | 'assistant' | 'tool';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}

export interface ToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  content: string | Array<TextPart | ImagePart>;
  isError?: boolean;
}

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

export interface Message {
  role: Role;
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export type ProviderRequest = Record<string, any>;
export type RawStreamChunk = any;

export interface ProcessedStreamChunk {
  type: 'text_delta' | 'tool_call_delta' | 'tool_call_start' | 'stop' | 'other';
  data: any;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface OnBeforeCallParams {
  request: ProviderRequest;
  timestamp: Date;
}

export interface OnMessageParams {
  chunk: ProcessedStreamChunk;
  rawChunk?: RawStreamChunk;
  timestamp: Date;
}

export interface OnErrorParams {
  error: Error;
  rawError?: any;
  timestamp: Date;
}

export interface OnFinishParams {
  finalResponse: Message | null;
  usage: Usage | null;
  stopReason: string | null;
  timestamp: Date;
  rawResponse?: any;
}

export interface GenerateParams {
  provider: Provider;
  modelId: string;
  messages: Message[];
  systemPrompt?: string;
  stream?: boolean;
  onBeforeCall?: (params: OnBeforeCallParams) => void | Promise<void>;
  onMessage?: (params: OnMessageParams) => void | Promise<void>;
  onError?: (params: OnErrorParams) => void | Promise<void>;
  onFinish?: (params: OnFinishParams) => void | Promise<void>;
  providerOptions?: Record<string, any>;
}

export interface GenerateResultStreaming {
  textStream: AsyncIterable<string>;
  finalResponse: () => Promise<Message | null>;
  usage: () => Promise<Usage | null>;
  stopReason: () => Promise<string | null>;
}

export interface GenerateResultNonStreaming {
  response: Message | null;
  usage: Usage | null;
  stopReason: string | null;
}

export type GenerateResult = GenerateResultStreaming | GenerateResultNonStreaming;

// Provider and ProviderOptions are now in src/providers/types.ts
