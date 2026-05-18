import {
  cancel,
  confirm,
  isCancel,
  multiselect,
  password,
  select,
  text
} from '@clack/prompts';
import type { AppConfig, McpServerConfig, ProviderKind } from '../core/types.js';
import { createDefaultConfig, getDefaultModel } from './schema.js';
import { saveConfig } from './persistence.js';
import { resolveProviderSecret, storeProviderApiKey } from '../providers/auth.js';
import { builtInProviderKinds, getProviderDefinition } from '../providers/catalog.js';
import { nativeToolCatalog } from '../tools/nativeTools.js';

function asArray(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function asRecord(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.every(([, item]) => typeof item === 'string')) {
        return parsed as Record<string, string>;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function jsonOrEmpty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2) ?? '{}';
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function promptMcpServer(existingServer?: McpServerConfig): Promise<McpServerConfig | null> {
  const name = await text({
    message: 'MCP server name',
    placeholder: 'filesystem',
    initialValue: existingServer?.name ?? ''
  });

  if (isCancel(name)) {
    return null;
  }

  const transport = await select({
    message: `Transport for ${name}`,
    options: [
      { label: 'stdio', value: 'stdio' },
      { label: 'http', value: 'http' }
    ],
    initialValue: existingServer?.transport ?? 'stdio'
  });

  if (isCancel(transport)) {
    return null;
  }

  if (transport === 'stdio') {
    const command = await text({
      message: 'Command to start the server',
      placeholder: 'node',
      initialValue: existingServer?.command ?? ''
    });

    if (isCancel(command)) {
      return null;
    }

    const args = await text({
      message: 'Command args as JSON array',
      placeholder: '["server.js"]',
      initialValue: jsonOrEmpty(existingServer?.args ?? [])
    });

    if (isCancel(args)) {
      return null;
    }

    const cwd = await text({
      message: 'Optional working directory',
      placeholder: 'C:/path/to/server',
      initialValue: existingServer?.cwd ?? ''
    });

    if (isCancel(cwd)) {
      return null;
    }

    const env = await text({
      message: 'Optional environment JSON object',
      placeholder: '{"DEBUG":"1"}',
      initialValue: jsonOrEmpty(existingServer?.env)
    });

    if (isCancel(env)) {
      return null;
    }

    const parsedEnv = asRecord(env);

    return {
      name,
      transport,
      command,
      args: asArray(args),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(parsedEnv ? { env: parsedEnv } : {}),
      enabled: existingServer?.enabled ?? true
    };
  }

  const url = await text({
    message: 'HTTP MCP endpoint URL',
    placeholder: 'http://localhost:3000/mcp',
    initialValue: existingServer?.url ?? ''
  });

  if (isCancel(url)) {
    return null;
  }

  const headers = await text({
    message: 'Optional request headers JSON object',
    placeholder: '{"Authorization":"Bearer ..."}',
    initialValue: jsonOrEmpty(existingServer?.headers)
  });

  if (isCancel(headers)) {
    return null;
  }

  const parsedHeaders = asRecord(headers);

  return {
    name,
    transport,
    url,
    ...(parsedHeaders ? { headers: parsedHeaders } : {}),
    enabled: existingServer?.enabled ?? true
  };
}

async function promptMcpServers(existingServers: McpServerConfig[]): Promise<McpServerConfig[] | null> {
  const nextServers: McpServerConfig[] = [];

  for (const server of existingServers) {
    const action = await select({
      message: `MCP server ${server.name}`,
      options: [
        { label: 'Keep', value: 'keep' },
        { label: 'Edit', value: 'edit' },
        { label: 'Remove', value: 'remove' }
      ],
      initialValue: 'keep'
    });

    if (isCancel(action)) {
      return null;
    }

    if (action === 'keep') {
      nextServers.push(server);
      continue;
    }

    if (action === 'edit') {
      const updatedServer = await promptMcpServer(server);
      if (!updatedServer) {
        return null;
      }

      nextServers.push(updatedServer);
    }
  }

  while (true) {
    const addServer = await confirm({ message: 'Add an MCP server?' });

    if (isCancel(addServer)) {
      return null;
    }

    if (!addServer) {
      break;
    }

    const server = await promptMcpServer();
    if (!server) {
      return null;
    }

    nextServers.push(server);
  }

  return nextServers;
}

async function promptProviderSettings(
  defaults: AppConfig,
  options: { includeAdvancedSettings: boolean }
): Promise<{
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
} | null> {
  const provider = await select({
    message: 'Select your primary provider',
    options: [
      ...builtInProviderKinds.map((kind) => ({
        label: getProviderDefinition(kind).label,
        value: kind
      })),
      { label: 'OpenAI-compatible endpoint', value: 'openai-compatible' }
    ],
    initialValue: defaults.provider.kind
  });

  if (isCancel(provider)) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  const model = await text({
    message: 'Default model',
    initialValue:
      provider === defaults.provider.kind
        ? defaults.provider.model
        : getDefaultModel(provider as ProviderKind)
  });

  if (isCancel(model)) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  let baseUrl: string | undefined;
  if (provider === 'openai-compatible') {
    const compatibleBaseUrl = await text({
      message: 'Base URL for the compatible endpoint',
      placeholder: 'https://example.com/v1',
      initialValue: defaults.provider.kind === 'openai-compatible' ? defaults.provider.baseUrl ?? '' : ''
    });

    if (isCancel(compatibleBaseUrl)) {
      cancel('Setup cancelled');
      process.exit(0);
    }

    baseUrl = compatibleBaseUrl.trim() || undefined;
  }

  if (!options.includeAdvancedSettings) {
    return {
      provider: provider as ProviderKind,
      model,
      ...(baseUrl ? { baseUrl } : {})
    };
  }

  let temperature = defaults.provider.temperature;
  while (true) {
    const temperatureInput = await text({
      message: 'Temperature (optional)',
      placeholder: '0.7',
      initialValue: defaults.provider.temperature?.toString() ?? ''
    });

    if (isCancel(temperatureInput)) {
      cancel('Setup cancelled');
      process.exit(0);
    }

    const parsedTemperature = numberOrUndefined(temperatureInput);
    if (parsedTemperature === undefined) {
      temperature = defaults.provider.temperature;
      break;
    }

    if (Number.isNaN(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
      console.log('Temperature must be a number between 0 and 2, or blank to keep the current value.');
      continue;
    }

    temperature = parsedTemperature;
    break;
  }

  let maxTokens = defaults.provider.maxTokens;
  while (true) {
    const maxTokensInput = await text({
      message: 'Max tokens (optional)',
      placeholder: '1024',
      initialValue: defaults.provider.maxTokens?.toString() ?? ''
    });

    if (isCancel(maxTokensInput)) {
      cancel('Setup cancelled');
      process.exit(0);
    }

    const parsedMaxTokens = numberOrUndefined(maxTokensInput);
    if (parsedMaxTokens === undefined) {
      maxTokens = defaults.provider.maxTokens;
      break;
    }

    if (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens <= 0) {
      console.log('Max tokens must be a positive whole number, or blank to keep the current value.');
      continue;
    }

    maxTokens = parsedMaxTokens;
    break;
  }

  return {
    provider: provider as ProviderKind,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {})
  };
}

async function promptProviderApiKey(provider: ProviderKind): Promise<void> {
  const currentSecret = await resolveProviderSecret(provider);
  const saveApiKey = await confirm({
    message: 'Store an API key now?',
    initialValue: Boolean(currentSecret)
  });

  if (isCancel(saveApiKey)) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  if (!saveApiKey) {
    return;
  }

  const apiKey = await password({
    message: 'API key'
  });

  if (isCancel(apiKey)) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  await storeProviderApiKey(provider, apiKey);
}

async function hasProviderSecret(provider: ProviderKind): Promise<boolean> {
  return Boolean(await resolveProviderSecret(provider));
}

function applyProviderSelection(
  defaults: AppConfig,
  selection: { provider: ProviderKind; model: string; baseUrl?: string; temperature?: number; maxTokens?: number }
): AppConfig {
  return {
    ...defaults,
    provider: {
      kind: selection.provider,
      model: selection.model,
      ...(selection.baseUrl ? { baseUrl: selection.baseUrl } : {}),
      ...(selection.temperature !== undefined ? { temperature: selection.temperature } : {}),
      ...(selection.maxTokens !== undefined ? { maxTokens: selection.maxTokens } : {})
    }
  };
}

export async function runConfigWizard(seedConfig?: AppConfig): Promise<AppConfig> {
  const defaults = seedConfig ?? createDefaultConfig();

  console.clear();

  const providerSelection = await promptProviderSettings(defaults, { includeAdvancedSettings: true });
  if (!providerSelection) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  const systemPrompt = await text({
    message: 'System prompt',
    initialValue: defaults.systemPrompt
  });

  if (isCancel(systemPrompt)) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  const nextSystemPrompt = systemPrompt.trim() || defaults.systemPrompt;
  await promptProviderApiKey(providerSelection.provider);

  const availableNativeTools = Object.entries(nativeToolCatalog).map(([name, tool]) => ({
    value: name,
    label: `${name} - ${tool.spec.description}`
  }));

  const nativeTools = await multiselect({
    message: 'Select native tools to enable',
    options: availableNativeTools,
    required: false,
    initialValues: defaults.tools.native
  });

  if (isCancel(nativeTools)) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  const mcpServers = await promptMcpServers(defaults.tools.mcpServers);
  if (!mcpServers) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  const config: AppConfig = {
    ...applyProviderSelection(defaults, providerSelection),
    systemPrompt: nextSystemPrompt,
    tools: {
      native: nativeTools as string[],
      mcpServers
    },
    ui: {
      autoConnectMcp: defaults.ui.autoConnectMcp
    }
  };

  await saveConfig(config);

  console.log('Saved config to ~/.agent/config.yaml');
  return config;
}

export async function runProviderSwitcher(seedConfig?: AppConfig): Promise<AppConfig> {
  const defaults = seedConfig ?? createDefaultConfig();

  console.clear();

  const providerSelection = await promptProviderSettings(defaults, { includeAdvancedSettings: false });
  if (!providerSelection) {
    cancel('Setup cancelled');
    process.exit(0);
  }

  await promptProviderApiKey(providerSelection.provider);
  if (!(await hasProviderSecret(providerSelection.provider))) {
    cancel(`No API key available for ${getProviderDefinition(providerSelection.provider).label}`);
    process.exit(1);
  }

  const config = applyProviderSelection(defaults, providerSelection);
  await saveConfig(config);

  console.log('Saved config to ~/.agent/config.yaml');
  return config;
}
