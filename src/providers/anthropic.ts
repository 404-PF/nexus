import type {
  ChatMessage,
  ProviderKind,
  ToolCall,
  ToolSpec,
} from '../core/types.js';
import type {
  LLMClient,
  ProviderCompletionRequest,
  ProviderCompletionResult,
} from './types.js';

interface AnthropicToolCallAccumulator {
  id: string;
  name: string;
  inputJson: string;
}

function formatErrorResponse(body: string): Error {
  return new Error(`Provider request failed: ${body}`);
}

function safeJsonParse(input: string): unknown {
  if (!input.trim()) {
    return {};
  }

  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

async function readSseStream(
  response: Response,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const splitPattern = /\r?\n\r?\n/;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let separatorMatch = splitPattern.exec(buffer);
    while (separatorMatch) {
      const chunk = buffer.slice(0, separatorMatch.index).trim();
      buffer = buffer.slice(separatorMatch.index + separatorMatch[0].length);
      separatorMatch = splitPattern.exec(buffer);

      if (!chunk) {
        continue;
      }

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
        }
      }

      onEvent(event, dataLines.join('\n'));
    }

    if (done) {
      const chunk = buffer.trim();
      if (chunk) {
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of chunk.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            event = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trim());
          }
        }

        onEvent(event, dataLines.join('\n'));
      }

      break;
    }
  }
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  const systemMessages: string[] = [];
  const payload: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemMessages.push(message.content);
      continue;
    }

    if (message.role === 'tool') {
      payload.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId ?? message.name ?? 'tool',
            content: message.content,
            is_error: false,
          },
        ],
      });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (message.content.trim()) {
        contentBlocks.push({
          type: 'text',
          text: message.content,
        });
      }

      for (const call of message.toolCalls) {
        contentBlocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
        });
      }

      payload.push({
        role: 'assistant',
        content: contentBlocks,
      });
      continue;
    }

    payload.push({
      role: message.role,
      content: message.content,
    });
  }

  return {
    ...(systemMessages.length > 0
      ? { system: systemMessages.join('\n\n') }
      : {}),
    messages: payload,
  };
}

function toAnthropicTools(tools: ToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function buildToolCalls(
  accumulators: AnthropicToolCallAccumulator[],
): ToolCall[] {
  return accumulators.map((accumulator) => ({
    id: accumulator.id,
    name: accumulator.name,
    arguments: safeJsonParse(accumulator.inputJson),
  }));
}

export class AnthropicClient implements LLMClient {
  public readonly provider: ProviderKind = 'anthropic';

  public readonly model: string;

  private readonly baseUrl: string;

  private readonly apiKey: string;

  private readonly temperature: number | undefined;

  private readonly maxTokens: number | undefined;

  public constructor(options: {
    model: string;
    baseUrl: string;
    apiKey: string;
    temperature: number | undefined;
    maxTokens: number | undefined;
  }) {
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens ?? 1024;
  }

  public async complete(
    request: ProviderCompletionRequest,
  ): Promise<ProviderCompletionResult> {
    const { system, messages } = toAnthropicMessages(request.messages);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      ...(request.signal ? { signal: request.signal } : {}),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        ...(system ? { system } : {}),
        messages,
        ...(request.tools.length > 0
          ? { tools: toAnthropicTools(request.tools) }
          : {}),
        ...(this.temperature !== undefined
          ? { temperature: this.temperature }
          : {}),
        max_tokens: this.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw formatErrorResponse(await response.text());
    }

    let text = '';
    const toolCalls: AnthropicToolCallAccumulator[] = [];
    const activeBlocks = new Map<number, AnthropicToolCallAccumulator>();

    await readSseStream(response, (event, data) => {
      if (!data) {
        return;
      }

      const payload = JSON.parse(data) as {
        type?: string;
        delta?: { type?: string; text?: string; partial_json?: string };
        content_block?: { type?: string; id?: string; name?: string };
        index?: number;
      };

      if (
        event === 'content_block_start' ||
        payload.type === 'content_block_start'
      ) {
        const block = payload.content_block;
        if (block?.type === 'tool_use') {
          const accumulator = {
            id: block.id ?? `tool-${activeBlocks.size}`,
            name: block.name ?? 'unknown-tool',
            inputJson: '',
          };
          activeBlocks.set(payload.index ?? activeBlocks.size, accumulator);
        }
        return;
      }

      if (
        event === 'content_block_delta' ||
        payload.type === 'content_block_delta'
      ) {
        const delta = payload.delta;
        if (!delta) {
          return;
        }

        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          text += delta.text;
          request.onToken?.(delta.text);
        }

        if (
          delta.type === 'input_json_delta' &&
          typeof delta.partial_json === 'string'
        ) {
          const accumulator = activeBlocks.get(payload.index ?? 0);
          if (accumulator) {
            accumulator.inputJson += delta.partial_json;
          }
        }

        return;
      }

      if (
        event === 'content_block_stop' ||
        payload.type === 'content_block_stop'
      ) {
        const accumulator = activeBlocks.get(payload.index ?? 0);
        if (accumulator) {
          toolCalls.push(accumulator);
          activeBlocks.delete(payload.index ?? 0);
        }
      }
    });

    const finalToolCalls = buildToolCalls(toolCalls);
    return {
      message: {
        role: 'assistant',
        content: text.trimEnd(),
        ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
      },
      toolCalls: finalToolCalls,
      raw: { text },
    };
  }
}
