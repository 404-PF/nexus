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

type OpenAIToolCallDelta = {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

interface OpenAIToolCallAccumulator {
  id: string | undefined;
  name: string | undefined;
  arguments: string;
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

function toOpenAIMessages(
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  const payload: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      payload.push({
        role: 'tool',
        tool_call_id: message.toolCallId ?? message.name ?? 'tool',
        content: message.content,
      });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCalls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      }));

      payload.push({
        role: 'assistant',
        ...(message.content ? { content: message.content } : {}),
        tool_calls: toolCalls,
      });
      continue;
    }

    payload.push({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
    });
  }

  return payload;
}

function toOpenAITools(tools: ToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function buildToolCalls(
  accumulators: Map<number, OpenAIToolCallAccumulator>,
): ToolCall[] {
  return [...accumulators.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, accumulator], index) => ({
      id: accumulator.id ?? `tool-${index}`,
      name: accumulator.name ?? 'unknown-tool',
      arguments: safeJsonParse(accumulator.arguments),
    }));
}

export class OpenAICompatibleClient implements LLMClient {
  public readonly provider: ProviderKind;

  public readonly model: string;

  private readonly baseUrl: string;

  private readonly apiKey: string;

  private readonly temperature: number | undefined;

  private readonly maxTokens: number | undefined;

  public constructor(options: {
    provider: ProviderKind;
    model: string;
    baseUrl: string;
    apiKey: string;
    temperature: number | undefined;
    maxTokens: number | undefined;
  }) {
    this.provider = options.provider;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
  }

  public async complete(
    request: ProviderCompletionRequest,
  ): Promise<ProviderCompletionResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      ...(request.signal ? { signal: request.signal } : {}),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(request.messages),
        tools: toOpenAITools(request.tools),
        ...(request.tools.length > 0 ? { tool_choice: 'auto' } : {}),
        ...(this.temperature !== undefined
          ? { temperature: this.temperature }
          : {}),
        ...(this.maxTokens !== undefined ? { max_tokens: this.maxTokens } : {}),
        stream: true,
      }),
    });

    if (!response.ok) {
      throw formatErrorResponse(await response.text());
    }

    let text = '';
    const toolCalls = new Map<number, OpenAIToolCallAccumulator>();

    await readSseStream(response, (event, data) => {
      if (event !== 'message' || !data.trim() || data === '[DONE]') {
        return;
      }

      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string;
            tool_calls?: OpenAIToolCallDelta[];
          };
        }>;
      };

      const delta = payload.choices?.[0]?.delta;
      if (!delta) {
        return;
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        text += delta.content;
        request.onToken?.(delta.content);
      }

      for (const call of delta.tool_calls ?? []) {
        const accumulator = toolCalls.get(call.index) ?? {
          id: undefined,
          name: undefined,
          arguments: '',
        };

        if (!accumulator.id) {
          accumulator.id = call.id;
        }

        if (!accumulator.name) {
          accumulator.name = call.function?.name;
        }

        accumulator.arguments += call.function?.arguments ?? '';
        toolCalls.set(call.index, accumulator);
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
