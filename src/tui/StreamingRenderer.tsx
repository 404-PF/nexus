import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import type {
  ChatMessage,
  McpInspectorSnapshot,
  McpServerInspection,
} from '../core/types.js';
import type { TranscriptSummary } from './session.js';

function roleLabel(role: ChatMessage['role']): string {
  switch (role) {
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
    case 'system':
      return 'system';
    case 'user':
    default:
      return 'you';
  }
}

function roleColor(
  role: ChatMessage['role'],
): 'green' | 'cyan' | 'gray' | 'magenta' {
  switch (role) {
    case 'assistant':
      return 'cyan';
    case 'tool':
      return 'magenta';
    case 'system':
      return 'gray';
    case 'user':
    default:
      return 'green';
  }
}

export function MessageList({
  messages,
  streamingText,
}: {
  messages: ChatMessage[];
  streamingText: string;
}): ReactElement {
  const visibleMessages = messages.slice(-12);

  return (
    <Box flexDirection="column" gap={1}>
      {visibleMessages.map((message, index) => (
        <Box
          key={`${message.role}-${index}`}
          flexDirection="column"
          marginBottom={1}
        >
          <Text color={roleColor(message.role)}>{roleLabel(message.role)}</Text>
          <Text>{message.content || '(empty)'}</Text>
        </Box>
      ))}
      {streamingText ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan">assistant</Text>
          <Text dimColor>{streamingText}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function StatusBar({
  status,
  provider,
  model,
  authSource,
  busy,
  error,
  title,
}: {
  status: string;
  provider: string;
  model: string;
  authSource: string;
  busy: boolean;
  error: string | undefined;
  title: string | undefined;
}): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={busy ? 'yellow' : 'green'}>
        {title ? `${title}  ` : ''}
        {status}
        {'  '}
        {provider}/{model}
        {'  '}
        auth {authSource}
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
    </Box>
  );
}

function statusColor(
  status: McpServerInspection['status'],
): 'green' | 'red' | 'gray' {
  switch (status) {
    case 'connected':
      return 'green';
    case 'error':
      return 'red';
    case 'disabled':
    default:
      return 'gray';
  }
}

export function McpInspectorPanel({
  inspector,
}: {
  inspector: McpInspectorSnapshot;
}): ReactElement | null {
  if (inspector.servers.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
    >
      <Text color="blue">MCP inspector</Text>
      <Text dimColor>MCP tools: {inspector.mcpToolCount}</Text>
      {inspector.servers.map((server) => (
        <Box key={server.name} flexDirection="column" marginTop={1}>
          <Text color={statusColor(server.status)}>
            {server.name} [{server.transport}] -{' '}
            {server.status === 'error' ? 'failed' : server.status}
          </Text>
          {server.tools.length > 0 ? (
            <Text dimColor>
              tools: {server.tools.slice(0, 5).join(', ')}
              {server.tools.length > 5
                ? ` (+${server.tools.length - 5} more)`
                : ''}
            </Text>
          ) : null}
          {server.error ? <Text color="red">{server.error}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

export function InputLine({
  draft,
  prompt,
  placeholder,
}: {
  draft: string;
  prompt: string;
  placeholder: string;
}): ReactElement {
  return (
    <Box marginTop={1}>
      <Text color="gray">{prompt}</Text>
      <Text>{draft || placeholder}</Text>
    </Box>
  );
}

export function CommandPalette({
  commands,
  selectedIndex,
}: {
  commands: Array<{ label: string; description: string }>;
  selectedIndex: number;
}): ReactElement {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
    >
      <Text color="blue">Command palette</Text>
      {commands.map((command, index) => (
        <Box
          key={`${command.label}-${index}`}
          flexDirection="column"
          marginTop={1}
        >
          <Text color={index === selectedIndex ? 'yellow' : 'white'}>
            {index === selectedIndex ? '>' : ' '} {command.label}
          </Text>
          <Text dimColor>{command.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

function formatTranscriptStamp(isoStamp: string): string {
  const date = new Date(isoStamp);
  if (Number.isNaN(date.getTime())) {
    return 'unknown time';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function TranscriptBrowser({
  transcripts,
  selectedIndex,
  loading,
}: {
  transcripts: TranscriptSummary[];
  selectedIndex: number;
  loading: boolean;
}): ReactElement {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text color="cyan">Transcript browser</Text>
      <Text dimColor>
        Use up/down and Enter to reopen a chat. Esc closes this view.
      </Text>
      {loading ? (
        <Box marginTop={1}>
          <Text>Loading transcripts...</Text>
        </Box>
      ) : transcripts.length === 0 ? (
        <Box marginTop={1}>
          <Text>No saved transcripts yet.</Text>
        </Box>
      ) : (
        transcripts.map((transcript, index) => (
          <Box key={transcript.id} flexDirection="column" marginTop={1}>
            <Text color={index === selectedIndex ? 'yellow' : 'white'}>
              {index === selectedIndex ? '>' : ' '} {transcript.label}
              {transcript.isCurrent ? ' (current)' : ''}
            </Text>
            <Text dimColor>
              {transcript.messageCount} messages
              {'  '}
              {formatTranscriptStamp(transcript.updatedAt)}
            </Text>
            <Text dimColor>{transcript.preview}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
