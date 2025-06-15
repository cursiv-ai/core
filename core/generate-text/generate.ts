/**
 * Generate text using a language model with a streamlined, provider-agnostic API.
 *
 * Key features:
 * - Single completion call (no multi-step flows)
 * - Tool definitions supported (tool calls returned but not executed automatically)
 * - Simple result structure with text, usage, and metadata
 * - Works with any AI SDK language model provider
 *
 * Example usage:
 * ```typescript
 * import { generate } from './generate'
 * import { openai } from '@ai-sdk/openai'
 * import { z } from 'zod'
 *
 * const result = await generate({
 *   model: openai('gpt-4'),
 *   prompt: 'What is the weather like in San Francisco?',
 *   tools: {
 *     getWeather: {
 *       description: 'Get weather for a location',
 *       parameters: z.object({
 *         location: z.string(),
 *       }),
 *     },
 *   },
 *   temperature: 0.7,
 *   maxTokens: 100,
 * })
 *
 * console.log(result.text)
 * console.log(`Used ${result.usage.totalTokens} tokens`)
 *
 * // Tool calls are returned but not executed automatically
 * if (result.toolCalls?.length) {
 *   console.log('Tool calls requested:', result.toolCalls)
 *   // You can handle tool execution manually if needed
 * }
 * ```
 */

import { CallSettings } from '../prompt/call-settings'
import { convertToLanguageModelPrompt } from '../prompt/convert-to-language-model-prompt'
import { prepareCallSettings } from '../prompt/prepare-call-settings'
import { prepareRetries } from '../prompt/prepare-retries'
import { prepareToolsAndToolChoice } from '../prompt/prepare-tools-and-tool-choice'
import { Prompt } from '../prompt/prompt'
import { standardizePrompt } from '../prompt/standardize-prompt'
import { LanguageModel, CallWarning, ToolChoice } from '../types'
import { ProviderOptions } from '../types/provider-metadata'
import { calculateLanguageModelUsage, LanguageModelUsage } from '../types/usage'
import { ToolSet } from './tool-set'

/**
 * Result returned by the generate function
 */
export interface GenerateResult<TOOLS extends ToolSet> {
  /** The generated text content */
  readonly text: string
  /** Reason why the generation finished */
  readonly finishReason:
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error'
    | 'other'
    | 'unknown'
  /** Token usage information */
  readonly usage: LanguageModelUsage
  /** Any warnings from the model provider */
  readonly warnings?: CallWarning[]
  /** Tool calls requested by the model (not executed) */
  readonly toolCalls?: Array<{
    toolCallId: string
    toolName: keyof TOOLS
    args: any
  }>
}

/**
 * Generate text using a language model in a single completion call.
 *
 * @param model - The language model to use
 * @param tools - Tools that can be called by the model (calls returned but not executed)
 * @param toolChoice - Strategy for tool selection ('auto', 'none', 'required', or specific tool)
 * @param system - System message to guide the model's behavior
 * @param prompt - Text prompt (use either prompt or messages, not both)
 * @param messages - Conversation messages (use either prompt or messages, not both)
 * @param maxRetries - Maximum number of retries on failure (default: 2)
 * @param abortSignal - Signal to abort the request
 * @param headers - Additional HTTP headers for the request
 * @param providerOptions - Provider-specific configuration options
 * @param settings - Generation settings (temperature, maxTokens, topP, etc.)
 */
export async function generate<TOOLS extends ToolSet>({
  model,
  tools,
  toolChoice,
  system,
  prompt,
  messages,
  maxRetries: maxRetriesArg,
  abortSignal,
  headers,
  providerOptions,
  ...settings
}: CallSettings &
  Prompt & {
    /**
     * The language model to use
     */
    model: LanguageModel

    /**
     * Tools that can be called by the model (calls returned but not executed)
     */
    tools?: TOOLS

    /**
     * Strategy for tool selection ('auto', 'none', 'required', or specific tool)
     */
    toolChoice?: ToolChoice<TOOLS>

    /**
     * Provider-specific configuration options
     */
    providerOptions?: ProviderOptions
  }): Promise<GenerateResult<TOOLS>> {
  const { maxRetries, retry } = prepareRetries({ maxRetries: maxRetriesArg })
  const callSettings = prepareCallSettings(settings)

  // Prepare the prompt for the language model
  const standardizedPrompt = standardizePrompt({
    prompt: { system, prompt, messages },
    tools,
  })

  // Convert prompt to the format expected by the language model
  const promptMessages = await convertToLanguageModelPrompt({
    prompt: {
      type: standardizedPrompt.type,
      system: standardizedPrompt.system,
      messages: standardizedPrompt.messages,
    },
    modelSupportsImageUrls: model.supportsImageUrls,
    modelSupportsUrl: model.supportsUrl?.bind(model),
  })

  // Configure the model with tools (if provided)
  const mode = {
    type: 'regular' as const,
    ...prepareToolsAndToolChoice({
      tools,
      toolChoice,
      activeTools: undefined,
    }),
  }

  // Generate text from the language model
  const result = await retry(() =>
    model.doGenerate({
      mode,
      ...callSettings,
      inputFormat: standardizedPrompt.type,
      prompt: promptMessages,
      providerMetadata: providerOptions,
      abortSignal,
      headers,
    }),
  )

  return {
    text: result.text ?? '',
    finishReason: result.finishReason,
    usage: calculateLanguageModelUsage(result.usage),
    warnings: result.warnings,
    toolCalls: result.toolCalls?.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName as keyof TOOLS,
      args: toolCall.args,
    })),
  }
}
