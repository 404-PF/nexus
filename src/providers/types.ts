import type {
  ChatMessage,
  ProviderKind,
  ToolCall,
  ToolSpec,
} from '../core/types.js';

export interface ProviderCompletionRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal | undefined;
  onToken?: (chunk: string) => void;
}

export interface ProviderCompletionResult {
  message: ChatMessage;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export interface LLMClient {
  readonly provider: ProviderKind;
  readonly model: string;
  complete(
    request: ProviderCompletionRequest,
  ): Promise<ProviderCompletionResult>;
  close?(): Promise<void>;
}
