import type {
  ToolExecutionContext,
  ToolResult,
  ToolSpec,
} from '../core/types.js';

export interface NativeToolDefinition {
  spec: ToolSpec;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const nativeToolCatalog: Record<string, NativeToolDefinition> = {
  'system.now': {
    spec: {
      name: 'system.now',
      description: 'Return the current time as an ISO timestamp.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    async execute() {
      return {
        content: new Date().toISOString(),
      };
    },
  },
  'agent.config': {
    spec: {
      name: 'agent.config',
      description: 'Summarize the active agent configuration.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    async execute(_input, context) {
      const summary = {
        provider: context.config.provider,
        nativeTools: context.config.tools.native,
        mcpServers: context.config.tools.mcpServers.map((server) => ({
          name: server.name,
          transport: server.transport,
          enabled: server.enabled ?? true,
        })),
      };

      return {
        content: stringifyJson(summary),
      };
    },
  },
  'agent.echo': {
    spec: {
      name: 'agent.echo',
      description: 'Echo a string value back to the model.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const value =
        input && typeof input === 'object'
          ? (input as { text?: unknown }).text
          : undefined;
      return {
        content: typeof value === 'string' ? value : '',
      };
    },
  },
};

export function resolveNativeTools(enabled: string[]): NativeToolDefinition[] {
  return enabled.flatMap((name) => {
    const tool = nativeToolCatalog[name];
    return tool ? [tool] : [];
  });
}
