import type {
  AppConfig,
  McpInspectorSnapshot,
  ToolExecutionContext,
  ToolResult,
  ToolSpec,
} from '../core/types.js';
import { resolveNativeTools } from './nativeTools.js';
import { McpBridge } from './mcpBridge.js';

interface RegisteredTool {
  spec: ToolSpec;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly nativeTools: RegisteredTool[] = [];

  private readonly mcpBridge = new McpBridge();

  private mcpTools: RegisteredTool[] = [];

  private mcpInspector: McpInspectorSnapshot = {
    mcpToolCount: 0,
    servers: [],
  };

  public constructor(private readonly config: AppConfig) {
    this.nativeTools = resolveNativeTools(config.tools.native).map((tool) => ({
      spec: tool.spec,
      execute: tool.execute,
    }));
  }

  public async refresh(): Promise<void> {
    const result = await this.mcpBridge.refresh(this.config.tools.mcpServers);
    const specs = result.specs;
    this.mcpInspector = result.inspector;
    this.mcpTools = specs.map((spec) => ({
      spec,
      execute: (input, context) =>
        this.mcpBridge.invoke(spec.name, input, context),
    }));
  }

  public getMcpInspector(): McpInspectorSnapshot {
    return structuredClone(this.mcpInspector);
  }

  public toProviderTools(): ToolSpec[] {
    return [...this.nativeTools, ...this.mcpTools].map((tool) => tool.spec);
  }

  public async invoke(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const candidate = [...this.nativeTools, ...this.mcpTools].find(
      (tool) => tool.spec.name === name,
    );
    if (!candidate) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return candidate.execute(input, context);
  }

  public async dispose(): Promise<void> {
    await this.mcpBridge.dispose();
  }
}
