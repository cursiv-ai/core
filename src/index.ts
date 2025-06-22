// src/index.ts
import {
  GenerateParams,
  GenerateResult
} from './types';
import { Provider } from './providers/types'; // Corrected import for Provider

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  const { provider, stream } = params; // Removed unused variables for skeleton

  try {
    const result = await provider.request(params);
    return result;
  } catch (error) {
    if (params.onError) {
      params.onError({
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date(),
      });
    } else {
      console.error("Error in generate function, no onError callback provided:", error);
    }
    if (!stream) {
        return {
            response: null,
            usage: null,
            stopReason: 'error',
        };
    } else {
        throw error;
    }
  }
}

export * from './types';
export * from './providers/types'; // Also export provider types
