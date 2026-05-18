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
import { testMcpServerConnection } from '../tools/mcpBridge.js';

function parseJsonArrayOfStrings(value: string): { value: string[] } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: [] };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return { value: parsed };
    }
  } catch {
    return { error: 'Command args must be valid JSON, like ["server.js"].' };
  }

  return { error: 'Command args must be a JSON array of strings.' };
}

function parseJsonRecordOfStrings(value: string, label: string): { value: Record<string, string> } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: {} };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.every(([, item]) => typeof item === 'string')) {
        return { value: parsed as Record<string, string> };
      }
    }
  } catch {
    return { error: `${label} must be valid JSON, like {"Authorization":"Bearer ..."}.` };
  }

  return { error: `${label} must be a JSON object with string values.` };
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

function normalizeHttpUrl(value: string): { value: string } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: 'HTTP MCP endpoint URL is required.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'HTTP MCP endpoint URL must start with http:// or https://.' };
    }

    return { value: trimmed };
  } catch {
    return { error: 'HTTP MCP endpoint URL must be a valid absolute URL.' };
  }
}

async function promptJsonArray(message: string, placeholder: string, initialValue: string): Promise<string[] | null> {
  while (true) {
    const input = await text({
      message,
      placeholder,
      initialValue
    });

    if (isCancel(input)) {
      return null;
    }

    const parsed = parseJsonArrayOfStrings(input);
    if ('value' in parsed) {
      return parsed.value;
    }

    console.log(parsed.error);
  }
}

async function promptJsonRecord(
  message: string,
  placeholder: string,
  initialValue: string,
  label: string
): Promise<Record<string, string> | null> {
  while (true) {
    const input = await text({
      message,
      placeholder,
      initialValue
    });

    if (isCancel(input)) {
      return null;
    }

    const parsed = parseJsonRecordOfStrings(input, label);
    if ('value' in parsed) {
      return parsed.value;
    }

    console.log(parsed.error);
  }
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

  const trimmedName = name.trim();
  if (!trimmedName) {
    console.log('MCP server name is required.');
    return promptMcpServer(existingServer);
  }

  const transport = await select({
    message: `Transport for ${trimmedName}`,
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
    let trimmedCommand = '';
    while (true) {
      const command = await text({
        message: 'Command to start the server',
        placeholder: 'node',
        initialValue: existingServer?.command ?? ''
      });

      if (isCancel(command)) {
        return null;
      }

      trimmedCommand = command.trim();
      if (trimmedCommand) {
        break;
      }

      console.log('stdio transport requires a command to start the server.');
    }

    const args = await promptJsonArray('Command args as JSON array', '["server.js"]', jsonOrEmpty(existingServer?.args ?? []));
    if (args === null) {
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

    const env = await promptJsonRecord(
      'Optional environment JSON object',
      '{"DEBUG":"1"}',
      jsonOrEmpty(existingServer?.env),
      'Environment JSON'
    );

    if (env === null) {
      return null;
    }

    const server: McpServerConfig = {
      name: trimmedName,
      transport,
      command: trimmedCommand,
      args,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      enabled: existingServer?.enabled ?? true
    };

    const shouldTest = await confirm({
      message: 'Test this MCP server connection now?',
      initialValue: true
    });

    if (isCancel(shouldTest)) {
      return null;
    }

    if (shouldTest) {
      try {
        const toolCount = await testMcpServerConnection(server);
        console.log(`MCP server test passed: ${server.name} connected and exposed ${toolCount} tool(s).`);
      } catch (error) {
        console.log(
          `MCP server test failed for ${server.name} [stdio]: ${error instanceof Error ? error.message : String(error)}`
        );

        const nextAction = await select({
          message: 'What would you like to do?',
          options: [
            { label: 'Edit this server', value: 'edit' },
            { label: 'Save anyway', value: 'save' },
            { label: 'Cancel setup', value: 'cancel' }
          ],
          initialValue: 'edit'
        });

        if (isCancel(nextAction) || nextAction === 'cancel') {
          return null;
        }

        if (nextAction === 'edit') {
          return promptMcpServer(server);
        }
      }
    }

    return server;
  }

  const url = await text({
    message: 'HTTP MCP endpoint URL',
    placeholder: 'http://localhost:3000/mcp',
    initialValue: existingServer?.url ?? ''
  });

  if (isCancel(url)) {
    return null;
  }

  let normalizedUrl = normalizeHttpUrl(url);
  while ('error' in normalizedUrl) {
    console.log(normalizedUrl.error);

    const retryUrl = await text({
      message: 'HTTP MCP endpoint URL',
      placeholder: 'http://localhost:3000/mcp',
      initialValue: existingServer?.url ?? ''
    });

    if (isCancel(retryUrl)) {
      return null;
    }

    normalizedUrl = normalizeHttpUrl(retryUrl);
  }

  const headers = await promptJsonRecord(
    'Optional request headers JSON object',
    '{"Authorization":"Bearer ..."}',
    jsonOrEmpty(existingServer?.headers),
    'Request headers JSON'
  );

  if (headers === null) {
    return null;
  }

  const server: McpServerConfig = {
    name: trimmedName,
    transport,
    url: normalizedUrl.value,
    ...(Object.keys(headers).length ? { headers } : {}),
    enabled: existingServer?.enabled ?? true
  };

  const shouldTest = await confirm({
    message: 'Test this MCP server connection now?',
    initialValue: true
  });

  if (isCancel(shouldTest)) {
    return null;
  }

  if (shouldTest) {
    try {
      const toolCount = await testMcpServerConnection(server);
      console.log(`MCP server test passed: ${server.name} connected and exposed ${toolCount} tool(s).`);
    } catch (error) {
      console.log(
        `MCP server test failed for ${server.name} [http]: ${error instanceof Error ? error.message : String(error)}`
      );

      const nextAction = await select({
        message: 'What would you like to do?',
        options: [
          { label: 'Edit this server', value: 'edit' },
          { label: 'Save anyway', value: 'save' },
          { label: 'Cancel setup', value: 'cancel' }
        ],
        initialValue: 'edit'
      });

      if (isCancel(nextAction) || nextAction === 'cancel') {
        return null;
      }

      if (nextAction === 'edit') {
        return promptMcpServer(server);
      }
    }
  }

  return server;
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
      ...(selection.temperature !== undefined
        ? { temperature: selection.temperature }
        : defaults.provider.temperature !== undefined
          ? { temperature: defaults.provider.temperature }
          : {}),
      ...(selection.maxTokens !== undefined
        ? { maxTokens: selection.maxTokens }
        : defaults.provider.maxTokens !== undefined
          ? { maxTokens: defaults.provider.maxTokens }
          : {})
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
