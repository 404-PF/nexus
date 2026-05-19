import { z } from 'zod';
import type { AppConfig, ProviderKind } from '../core/types.js';
import { DEFAULT_SYSTEM_PROMPT } from '../core/prompts.js';
import { getDefaultProviderModel } from '../providers/catalog.js';

export const providerKindSchema = z.enum([
  'openai',
  'anthropic',
  'xai',
  'groq',
  'mistral',
  'openai-compatible',
]);

export const mcpServerSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'http']),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  url: z.string().url().optional(),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});

export const appConfigSchema = z.object({
  provider: z.object({
    kind: providerKindSchema,
    model: z.string().min(1),
    baseUrl: z.string().url().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  }),
  systemPrompt: z.string().trim().min(1).default(DEFAULT_SYSTEM_PROMPT),
  tools: z.object({
    native: z.array(z.string().min(1)),
    mcpServers: z.array(mcpServerSchema),
  }),
  ui: z.object({
    autoConnectMcp: z.boolean(),
  }),
}) as z.ZodType<AppConfig>;

export function createDefaultConfig(): AppConfig {
  return {
    provider: {
      kind: 'openai',
      model: 'gpt-4.1-mini',
    },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    tools: {
      native: ['system.now', 'agent.config'],
      mcpServers: [],
    },
    ui: {
      autoConnectMcp: true,
    },
  };
}

export function parseConfig(input: unknown): AppConfig {
  return appConfigSchema.parse(input);
}

export function getDefaultModel(kind: ProviderKind): string {
  return getDefaultProviderModel(kind);
}
