import type { AppConfig, ChatMessage, McpInspectorSnapshot } from './types.js';

export interface AgentStateSnapshot {
  config: AppConfig;
  messages: ChatMessage[];
  title: string | undefined;
  authSource: ProviderAuthSource;
  status: string;
  isBusy: boolean;
  streamingText: string;
  error: string | undefined;
  mcpInspector: McpInspectorSnapshot;
}

export type ProviderAuthSource = 'env' | 'keychain' | 'file' | 'missing';

type StateListener = () => void;

export interface AgentStateOptions {
  initialMessages?: ChatMessage[];
  initialTitle?: string | undefined;
  onConversationChange?: (
    messages: ChatMessage[],
    title: string | undefined,
  ) => void | Promise<void>;
}

export class AgentStateManager {
  private snapshotValue: AgentStateSnapshot;

  private readonly listeners = new Set<StateListener>();

  private readonly onConversationChange:
    | ((
        messages: ChatMessage[],
        title: string | undefined,
      ) => void | Promise<void>)
    | undefined;

  public constructor(config: AppConfig, options: AgentStateOptions = {}) {
    this.onConversationChange = options.onConversationChange;
    this.snapshotValue = {
      config,
      messages: structuredClone(options.initialMessages ?? []),
      title: options.initialTitle,
      authSource: 'missing',
      status: 'Idle',
      isBusy: false,
      streamingText: '',
      error: undefined,
      mcpInspector: {
        mcpToolCount: 0,
        servers: [],
      },
    };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): AgentStateSnapshot {
    return this.snapshotValue;
  }

  public markBusy(status: string): void {
    this.update((snapshot) => {
      snapshot.isBusy = true;
      snapshot.status = status;
      snapshot.error = undefined;
      snapshot.streamingText = '';
    });
  }

  public markIdle(status = 'Idle'): void {
    this.update((snapshot) => {
      snapshot.isBusy = false;
      snapshot.status = status;
      snapshot.streamingText = '';
    });
  }

  public setStatus(status: string): void {
    this.update((snapshot) => {
      snapshot.status = status;
    });
  }

  public setError(error: string): void {
    this.update((snapshot) => {
      snapshot.error = error;
      snapshot.status = 'Error';
      snapshot.isBusy = false;
      snapshot.streamingText = '';
    });
  }

  public appendMessage(message: ChatMessage): void {
    this.update((snapshot) => {
      snapshot.messages = [...snapshot.messages, structuredClone(message)];
    });

    this.notifyConversationChange();
  }

  public setStreamingText(text: string): void {
    this.update((snapshot) => {
      snapshot.streamingText = text;
    });
  }

  public appendStreamingText(chunk: string): void {
    if (!chunk) {
      return;
    }

    this.update((snapshot) => {
      snapshot.streamingText += chunk;
    });
  }

  public clearStreamingText(): void {
    this.update((snapshot) => {
      snapshot.streamingText = '';
    });
  }

  public clearConversation(): void {
    this.update((snapshot) => {
      snapshot.messages = [];
      snapshot.title = undefined;
      snapshot.status = 'Idle';
      snapshot.isBusy = false;
      snapshot.streamingText = '';
      snapshot.error = undefined;
      snapshot.mcpInspector = { mcpToolCount: 0, servers: [] };
    });

    this.notifyConversationChange();
  }

  public replaceConversation(messages: ChatMessage[], title?: string): void {
    this.update((snapshot) => {
      snapshot.messages = structuredClone(messages);
      snapshot.title = title;
      snapshot.status = 'Idle';
      snapshot.isBusy = false;
      snapshot.streamingText = '';
      snapshot.error = undefined;
    });

    this.notifyConversationChange();
  }

  public setTitle(title: string): void {
    this.update((snapshot) => {
      snapshot.title = title;
    });

    this.notifyConversationChange();
  }

  public replaceConfig(config: AppConfig): void {
    this.update((snapshot) => {
      snapshot.config = config;
    });
  }

  public setMcpInspector(mcpInspector: McpInspectorSnapshot): void {
    this.update((snapshot) => {
      snapshot.mcpInspector = structuredClone(mcpInspector);
    });
  }

  public setAuthSource(authSource: ProviderAuthSource): void {
    this.update((snapshot) => {
      snapshot.authSource = authSource;
    });
  }

  private update(mutator: (snapshot: AgentStateSnapshot) => void): void {
    const nextSnapshot: AgentStateSnapshot = {
      ...this.snapshotValue,
      messages: [...this.snapshotValue.messages],
      mcpInspector: structuredClone(this.snapshotValue.mcpInspector),
    };
    mutator(nextSnapshot);
    this.snapshotValue = nextSnapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private notifyConversationChange(): void {
    if (!this.onConversationChange) {
      return;
    }

    void this.onConversationChange(
      structuredClone(this.snapshotValue.messages),
      this.snapshotValue.title,
    );
  }
}
