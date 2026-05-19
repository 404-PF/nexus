import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  McpInspectorSnapshot,
  McpServerConfig,
  McpServerInspection,
  ToolExecutionContext,
  ToolResult,
  ToolSpec,
} from '../core/types.js';

interface McpSession {
  server: McpServerConfig;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  toolNames: Map<string, string>;
  tools: Array<{
    fullName: string;
    originalName: string;
    description: string | undefined;
    inputSchema: Record<string, unknown>;
  }>;
}

function stringifyToolContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  return `${JSON.stringify(content, null, 2)}\n`;
}

function formatToolResult(result: unknown): ToolResult {
  if (result && typeof result === 'object' && 'content' in result) {
    const raw = result as {
      content?: unknown;
      isError?: boolean;
    };

    return {
      content: Array.isArray(raw.content)
        ? raw.content.map((item) => stringifyToolContent(item)).join('\n')
        : stringifyToolContent(raw.content),
      isError: raw.isError ?? false,
      raw: result,
    };
  }

  return {
    content: stringifyToolContent(result),
    raw: result,
  };
}

async function createSession(server: McpServerConfig): Promise<McpSession> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

  const client = new Client({
    name: 'nexus-agi',
    version: '0.1.0',
  });

  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if (server.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: server.command ?? 'node',
      args: server.args ?? [],
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.env ? { env: server.env } : {}),
    });
  } else {
    if (!server.url) {
      throw new Error(`HTTP server "${server.name}" is missing a URL`);
    }

    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      ...(server.headers ? { requestInit: { headers: server.headers } } : {}),
    });
  }

  const toolNames = new Map<string, string>();
  const tools: McpSession['tools'] = [];

  try {
    await client.connect(
      transport as unknown as Parameters<typeof client.connect>[0],
    );

    let cursor: string | undefined;

    do {
      const page = await client.listTools({ cursor });
      for (const tool of page.tools) {
        const fullName = `${server.name}.${tool.name}`;

        toolNames.set(fullName, tool.name);
        tools.push({
          fullName,
          originalName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  } catch (err) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    throw err;
  }

  return {
    server,
    client,
    transport,
    toolNames,
    tools,
  };
}

export async function testMcpServerConnection(
  server: McpServerConfig,
): Promise<number> {
  const session = await createSession(server);

  try {
    return session.tools.length;
  } finally {
    await disposeSession(session);
  }
}

async function disposeSession(session: McpSession): Promise<void> {
  try {
    await session.client.close();
  } catch {
    debugMcpBridge(`MCP session close failed for ${session.server.name}`);
    // Best-effort cleanup; the refreshed sessions are already active.
  }

  try {
    await session.transport.close();
  } catch {
    debugMcpBridge(`MCP transport close failed for ${session.server.name}`);
    // Best-effort cleanup; transport shutdown should not block refresh or exit.
  }
}

const DEBUG = !!process.env.DEBUG?.includes('opencode:mcp');

function debugMcpBridge(message: string): void {
  if (DEBUG) {
    process.stderr.write(`[mcp] ${message}\n`);
  }
}

export interface McpRefreshResult {
  inspector: McpInspectorSnapshot;
  specs: ToolSpec[];
}

export class McpBridge {
  private readonly sessions = new Map<string, McpSession>();

  public async refresh(servers: McpServerConfig[]): Promise<McpRefreshResult> {
    const specs: ToolSpec[] = [];
    const nextSessions = new Map<string, McpSession>();
    const inspectedServers: McpServerInspection[] = [];

    for (const server of servers) {
      if (!server.name.trim()) {
        continue;
      }

      if (server.enabled === false) {
        inspectedServers.push({
          name: server.name,
          transport: server.transport,
          enabled: false,
          status: 'disabled',
          tools: [],
        });
        continue;
      }

      try {
        const session = await createSession(server);
        nextSessions.set(server.name, session);

        for (const tool of session.tools) {
          specs.push({
            name: tool.fullName,
            description:
              tool.description ??
              `MCP tool from ${server.name}: ${tool.originalName}`,
            inputSchema: tool.inputSchema,
          });
        }

        inspectedServers.push({
          name: server.name,
          transport: server.transport,
          enabled: true,
          status: 'connected',
          tools: session.tools.map((tool) => tool.originalName),
        });
      } catch (error) {
        inspectedServers.push({
          name: server.name,
          transport: server.transport,
          enabled: true,
          status: 'error',
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const oldSessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const [serverName, session] of nextSessions.entries()) {
      this.sessions.set(serverName, session);
    }

    for (const session of oldSessions) {
      await disposeSession(session);
    }

    return {
      inspector: {
        mcpToolCount: specs.length,
        servers: inspectedServers,
      },
      specs,
    };
  }

  public async invoke(
    name: string,
    input: unknown,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    void _context;
    const session = [...this.sessions.values()].find((candidate) =>
      candidate.toolNames.has(name),
    );
    if (!session) {
      throw new Error(`MCP tool not connected: ${name}`);
    }

    const originalName = session.toolNames.get(name);
    if (!originalName) {
      throw new Error(`MCP tool not found: ${name}`);
    }

    const result = await session.client.callTool({
      name: originalName,
      arguments:
        typeof input === 'object' && input !== null
          ? (input as Record<string, unknown>)
          : {},
    });

    return formatToolResult(result);
  }

  public async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();

    for (const session of sessions) {
      await disposeSession(session);
    }
  }
}
