import type { ProviderKind } from '../core/types.js';

export type ProviderClientKind = 'anthropic' | 'openai-compatible';

export interface ProviderDefinition {
  label: string;
  clientKind: ProviderClientKind;
  defaultBaseUrl: string | undefined;
  defaultModel: string;
  envVars: readonly string[];
}

export const providerCatalog = {
  openai: {
    label: 'OpenAI',
    clientKind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    envVars: ['OPENAI_API_KEY'],
  },
  anthropic: {
    label: 'Anthropic',
    clientKind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    envVars: ['ANTHROPIC_API_KEY'],
  },
  xai: {
    label: 'xAI',
    clientKind: 'openai-compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.3',
    envVars: ['XAI_API_KEY'],
  },
  groq: {
    label: 'Groq',
    clientKind: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    envVars: ['GROQ_API_KEY'],
  },
  mistral: {
    label: 'Mistral',
    clientKind: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    envVars: ['MISTRAL_API_KEY'],
  },
  'openai-compatible': {
    label: 'OpenAI-compatible endpoint',
    clientKind: 'openai-compatible',
    defaultBaseUrl: undefined,
    defaultModel: 'gpt-4.1-mini',
    envVars: ['OPENAI_COMPATIBLE_API_KEY', 'OPENAI_API_KEY'],
  },
} satisfies Record<ProviderKind, ProviderDefinition>;

export const builtInProviderKinds = [
  'openai',
  'anthropic',
  'xai',
  'groq',
  'mistral',
] as const;

export function getProviderDefinition(kind: ProviderKind): ProviderDefinition {
  return providerCatalog[kind];
}

export function getProviderLabel(kind: ProviderKind): string {
  return providerCatalog[kind].label;
}

export function getProviderBaseUrl(kind: ProviderKind): string | undefined {
  return providerCatalog[kind].defaultBaseUrl;
}

export function getDefaultProviderModel(kind: ProviderKind): string {
  return providerCatalog[kind].defaultModel;
}

export function getProviderSecretEnvVars(
  kind: ProviderKind,
): readonly string[] {
  return providerCatalog[kind].envVars;
}
