// src/providers/types.ts
import { GenerateParams, GenerateResult } from '../types'; // Adjusted path

export interface ProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: any;
}

export interface Provider {
  request(params: GenerateParams): Promise<GenerateResult>;
  // May add other methods like listModels, etc. in the future
}
