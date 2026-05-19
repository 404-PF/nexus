export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'groq'
  | 'mistral'
  | 'openai-compatible';

export interface ProviderSettings {
  kind: ProviderKind;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  raw?: unknown;
}

export type McpServerStatus = 'connected' | 'disabled' | 'error';

export interface McpServerInspection {
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
  status: McpServerStatus;
  tools: string[];
  error?: string;
}

export interface McpInspectorSnapshot {
  mcpToolCount: number;
  servers: McpServerInspection[];
}

export interface ToolExecutionContext {
  config: AppConfig;
  signal?: AbortSignal;
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface AppConfig {
  provider: ProviderSettings;
  systemPrompt: string;
  tools: {
    native: string[];
    mcpServers: McpServerConfig[];
  };
  ui: {
    autoConnectMcp: boolean;
  };
}
