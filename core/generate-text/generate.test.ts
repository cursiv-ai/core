import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { generate } from './generate'
import { MockLanguageModelV1 } from '../test/mock-language-model-v1'

describe('generate function', () => {
  describe('basic text generation', () => {
    it('should generate text successfully', async () => {
      const mockModel = new MockLanguageModelV1({
        provider: 'mock-openai',
        modelId: 'gpt-3.5-turbo',
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Lines of code flow\nDebugging through the night\nBugs become features',
          finishReason: 'stop',
          usage: {
            promptTokens: 15,
            completionTokens: 25,
            totalTokens: 40,
          },
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockModel,
        prompt: 'Write a haiku about coding.',
        temperature: 0.7,
        maxTokens: 100,
      })

      expect(result.text).toBe(
        'Lines of code flow\nDebugging through the night\nBugs become features',
      )
      expect(result.finishReason).toBe('stop')
      expect(result.usage.totalTokens).toBe(40)
      expect(result.usage.promptTokens).toBe(15)
      expect(result.usage.completionTokens).toBe(25)
      expect(result.warnings).toBeUndefined()

      expect(mockModel.doGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          inputFormat: 'prompt',
          prompt: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                  text: 'Write a haiku about coding.',
                }),
              ]),
            }),
          ]),
          mode: expect.objectContaining({ type: 'regular' }),
        }),
      )
    })
  })

  describe('text generation with tools', () => {
    it('should generate text with tool calls', async () => {
      const mockModel = new MockLanguageModelV1({
        provider: 'mock-openai',
        modelId: 'gpt-3.5-turbo',
        doGenerate: vi.fn().mockResolvedValue({
          text: 'I can help you check the weather in Paris and get the current time there.',
          finishReason: 'tool-calls',
          usage: {
            promptTokens: 45,
            completionTokens: 30,
            totalTokens: 75,
          },
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'getWeather',
              args: { city: 'Paris', unit: 'celsius' },
            },
            {
              toolCallType: 'function',
              toolCallId: 'call-2',
              toolName: 'getCurrentTime',
              args: { city: 'Paris', timezone: 'Europe/Paris' },
            },
          ],
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockModel,
        prompt:
          'What is the weather like in Paris today? Also, what time is it there?',
        tools: {
          getWeather: {
            description: 'Get current weather for a city',
            parameters: z.object({
              city: z.string().describe('The city name'),
              unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
            }),
          },
          getCurrentTime: {
            description: 'Get current time for a city',
            parameters: z.object({
              city: z.string().describe('The city name'),
              timezone: z
                .string()
                .optional()
                .describe('Optional timezone identifier'),
            }),
          },
        },
        toolChoice: 'auto',
        temperature: 0.3,
        maxTokens: 200,
      })

      expect(result.text).toBe(
        'I can help you check the weather in Paris and get the current time there.',
      )
      expect(result.finishReason).toBe('tool-calls')
      expect(result.usage.totalTokens).toBe(75)
      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolCalls).toBeDefined()

      expect(result.toolCalls![0]).toEqual({
        toolCallId: 'call-1',
        toolName: 'getWeather',
        args: { city: 'Paris', unit: 'celsius' },
      })

      expect(result.toolCalls![1]).toEqual({
        toolCallId: 'call-2',
        toolName: 'getCurrentTime',
        args: { city: 'Paris', timezone: 'Europe/Paris' },
      })

      expect(mockModel.doGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: expect.objectContaining({
            type: 'regular',
            tools: expect.arrayContaining([
              expect.objectContaining({
                type: 'function',
                name: 'getWeather',
              }),
              expect.objectContaining({
                type: 'function',
                name: 'getCurrentTime',
              }),
            ]),
            toolChoice: { type: 'auto' },
          }),
        }),
      )
    })
  })

  describe('conversation with messages', () => {
    it('should handle conversation context', async () => {
      const mockModel = new MockLanguageModelV1({
        provider: 'mock-openai',
        modelId: 'gpt-3.5-turbo',
        doGenerate: vi.fn().mockResolvedValue({
          text: 'The main benefits of TypeScript include better code reliability through static typing, improved developer experience with enhanced IDE support, easier refactoring, and catching errors at compile-time rather than runtime.',
          finishReason: 'stop',
          usage: {
            promptTokens: 85,
            completionTokens: 45,
            totalTokens: 130,
          },
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockModel,
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant.' },
          {
            role: 'user',
            content: 'Explain what TypeScript is in one sentence.',
          },
          {
            role: 'assistant',
            content:
              'TypeScript is a strongly typed programming language that builds on JavaScript by adding static type definitions.',
          },
          { role: 'user', content: 'What are the main benefits?' },
        ],
        temperature: 0.5,
        maxTokens: 150,
      })

      expect(result.text).toContain('benefits of TypeScript')
      expect(result.finishReason).toBe('stop')
      expect(result.usage.totalTokens).toBe(130)

      expect(mockModel.doGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          inputFormat: 'messages',
          temperature: 0.5,
          maxTokens: 150,
        }),
      )
    })
  })

  describe('required tool usage', () => {
    it('should force tool usage when toolChoice is required', async () => {
      const mockModel = new MockLanguageModelV1({
        provider: 'mock-openai',
        modelId: 'gpt-3.5-turbo',
        doGenerate: vi.fn().mockResolvedValue({
          text: '',
          finishReason: 'tool-calls',
          usage: {
            promptTokens: 25,
            completionTokens: 10,
            totalTokens: 35,
          },
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-weather-1',
              toolName: 'getWeather',
              args: { city: 'Tokyo', unit: 'celsius' },
            },
          ],
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockModel,
        prompt: 'I need to know the current temperature in Tokyo.',
        tools: {
          getWeather: {
            description: 'Get current weather for a city',
            parameters: z.object({
              city: z.string().describe('The city name'),
              unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
            }),
          },
        },
        toolChoice: 'required',
        temperature: 0.1,
        maxTokens: 100,
      })

      expect(result.text).toBe('')
      expect(result.finishReason).toBe('tool-calls')
      expect(result.usage.totalTokens).toBe(35)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls).toBeDefined()
      expect(result.toolCalls![0]).toEqual({
        toolCallId: 'call-weather-1',
        toolName: 'getWeather',
        args: { city: 'Tokyo', unit: 'celsius' },
      })

      expect(mockModel.doGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: expect.objectContaining({
            toolChoice: { type: 'required' },
          }),
        }),
      )
    })
  })

  describe('anthropic-style models', () => {
    it('should work with claude models', async () => {
      const mockClaudeModel = new MockLanguageModelV1({
        provider: 'mock-anthropic',
        modelId: 'claude-3-haiku-20240307',
        doGenerate: vi.fn().mockResolvedValue({
          text: 'In circuits bright and data streams,\nAI learns and grows and dreams,\nThought made of light,\nLogic takes flight,—\nFuture built on silicon themes.',
          finishReason: 'stop',
          usage: {
            promptTokens: 20,
            completionTokens: 35,
            totalTokens: 55,
          },
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockClaudeModel,
        prompt: 'Write a short poem about artificial intelligence.',
        temperature: 0.7,
        maxTokens: 100,
      })

      expect(result.text).toContain('AI')
      expect(result.finishReason).toBe('stop')
      expect(result.usage.totalTokens).toBe(55)
      expect(mockClaudeModel.doGenerate).toHaveBeenCalled()
    })

    it('should handle claude with tools', async () => {
      const mockClaudeModel = new MockLanguageModelV1({
        provider: 'mock-anthropic',
        modelId: 'claude-3-haiku-20240307',
        doGenerate: vi.fn().mockResolvedValue({
          text: 'I can help you calculate the area of that rectangle.',
          finishReason: 'tool-calls',
          usage: {
            promptTokens: 40,
            completionTokens: 20,
            totalTokens: 60,
          },
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'calc-area-1',
              toolName: 'calculateRectangleArea',
              args: { width: 5, length: 8 },
            },
          ],
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockClaudeModel,
        prompt:
          'Help me calculate the area of a rectangle that is 5 meters wide and 8 meters long.',
        tools: {
          calculateRectangleArea: {
            description: 'Calculate the area of a rectangle',
            parameters: z.object({
              width: z.number().describe('Width in meters'),
              length: z.number().describe('Length in meters'),
            }),
          },
        },
        toolChoice: 'auto',
        temperature: 0.2,
        maxTokens: 150,
      })

      expect(result.text).toContain('calculate')
      expect(result.finishReason).toBe('tool-calls')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls).toBeDefined()
      expect(result.toolCalls![0].args).toEqual({ width: 5, length: 8 })
    })

    it('should handle claude conversation', async () => {
      const mockClaudeModel = new MockLanguageModelV1({
        provider: 'mock-anthropic',
        modelId: 'claude-3-haiku-20240307',
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Machine learning is a broader field that uses algorithms to learn patterns from data, while deep learning is a specific subset that uses neural networks with multiple layers to model complex patterns and representations.',
          finishReason: 'stop',
          usage: {
            promptTokens: 50,
            completionTokens: 45,
            totalTokens: 95,
          },
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      const result = await generate({
        model: mockClaudeModel,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant who explains things concisely.',
          },
          {
            role: 'user',
            content:
              'What is the difference between machine learning and deep learning?',
          },
        ],
        temperature: 0.3,
        maxTokens: 200,
      })

      expect(result.text.toLowerCase()).toContain('machine learning')
      expect(result.text.toLowerCase()).toContain('deep learning')
      expect(result.usage.totalTokens).toBe(95)
    })
  })

  describe('error handling', () => {
    it('should handle model errors gracefully', async () => {
      const mockModel = new MockLanguageModelV1({
        doGenerate: vi.fn().mockRejectedValue(new Error('Model API error')),
      })

      await expect(
        generate({
          model: mockModel,
          prompt: 'This should fail',
        }),
      ).rejects.toThrow('Model API error')
    })
  })

  describe('model configuration', () => {
    it('should pass through model settings correctly', async () => {
      const mockModel = new MockLanguageModelV1({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Response',
          finishReason: 'stop',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          rawCall: { rawPrompt: '', rawSettings: {} },
        }),
      })

      await generate({
        model: mockModel,
        prompt: 'Test prompt',
        temperature: 0.8,
        maxTokens: 150,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        stopSequences: ['STOP'],
      })

      expect(mockModel.doGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.8,
          maxTokens: 150,
          topP: 0.9,
          frequencyPenalty: 0.1,
          presencePenalty: 0.2,
          stopSequences: ['STOP'],
        }),
      )
    })
  })
})
