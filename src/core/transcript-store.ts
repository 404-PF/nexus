import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import YAML from 'yaml';
import { z } from 'zod';
import { agentHomeDir } from '../config/persistence.js';
import type { ChatMessage } from './types.js';

const DEBUG = !!process.env.DEBUG?.includes('opencode:transcripts');

function debug(message: string): void {
  if (DEBUG) {
    process.stderr.write(`[transcripts] ${message}\n`);
  }
}

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.unknown(),
});

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
});

const transcriptSchema = z.object({
  messages: z.array(chatMessageSchema),
  title: z.string().optional(),
});

export const transcriptPath = join(agentHomeDir, 'history.yaml');
const transcriptArchiveDir = join(agentHomeDir, 'history');
const transcriptArchiveIndex = join(agentHomeDir, 'history', '.index.yaml');

const archiveIndexEntrySchema = z.object({
  id: z.string(),
  messageCount: z.number(),
  preview: z.string(),
  updatedAt: z.string(),
  title: z.string().or(z.undefined()).optional(),
});

const archiveIndexSchema = z.object({
  entries: z.array(archiveIndexEntrySchema),
});

type ArchiveSummary = {
  id: string;
  messageCount: number;
  preview: string;
  updatedAt: string;
  title: string | undefined;
};

async function ensureAgentHome(): Promise<void> {
  await mkdir(agentHomeDir, { recursive: true });
}

async function ensureTranscriptArchiveDir(): Promise<void> {
  await ensureAgentHome();
  await mkdir(transcriptArchiveDir, { recursive: true });
}

function mapTranscriptMessage(
  message: z.infer<typeof chatMessageSchema>,
): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.name !== undefined ? { name: message.name } : {}),
    ...(message.toolCallId !== undefined
      ? { toolCallId: message.toolCallId }
      : {}),
    ...(message.toolCalls !== undefined
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })),
        }
      : {}),
  };
}

function summarizeTranscript(messages: ChatMessage[]): string {
  const firstMeaningfulMessage = messages.find(
    (message) => message.role !== 'system',
  );
  if (!firstMeaningfulMessage) {
    return 'Empty transcript';
  }

  const preview = firstMeaningfulMessage.content.trim().replace(/\s+/g, ' ');
  if (!preview) {
    return 'Empty transcript';
  }

  return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
}

function stringifyToolArguments(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

function formatTranscriptExport(messages: ChatMessage[]): string {
  const lines: string[] = [];

  lines.push('Nexus transcript export');
  lines.push(`Exported at: ${new Date().toISOString()}`);
  lines.push(`Message count: ${messages.length}`);
  lines.push('');

  messages.forEach((message, index) => {
    lines.push(`Message ${index + 1}`);
    lines.push(`Role: ${message.role}`);

    if (message.name) {
      lines.push(`Name: ${message.name}`);
    }

    if (message.toolCallId) {
      lines.push(`Tool call ID: ${message.toolCallId}`);
    }

    lines.push('Content:');
    lines.push(message.content.length > 0 ? message.content : '(empty)');

    if (message.toolCalls && message.toolCalls.length > 0) {
      lines.push('Tool calls:');
      for (const toolCall of message.toolCalls) {
        lines.push(`- ${toolCall.name} (${toolCall.id})`);
        lines.push('  Arguments:');

        const serializedArguments = stringifyToolArguments(
          toolCall.arguments,
        ).split('\n');
        for (const line of serializedArguments) {
          lines.push(`    ${line}`);
        }
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

export async function exportTranscript(
  messages: ChatMessage[],
  filePath: string,
): Promise<void> {
  const outputPath = resolve(filePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatTranscriptExport(messages), {
    encoding: 'utf8',
  });
}

function createArchiveFileName(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.yaml`;
}

async function statIfExists(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function readArchiveSummaryFromFile(
  fileName: string,
): Promise<ArchiveSummary | null> {
  const filePath = join(transcriptArchiveDir, fileName);

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = transcriptSchema.parse(YAML.parse(raw));
    const messages = parsed.messages.map(mapTranscriptMessage);
    const fileStat = await stat(filePath);
    return {
      id: fileName,
      messageCount: messages?.length ?? 0,
      preview: summarizeTranscript(messages ?? []),
      updatedAt: fileStat.mtime.toISOString(),
      title: parsed.title,
    };
  } catch (error) {
    debug(
      `Failed to read archived transcript ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function listArchiveFiles(): Promise<string[]> {
  try {
    const entries = await readdir(transcriptArchiveDir, {
      withFileTypes: true,
    });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.yaml') &&
          entry.name !== '.index.yaml',
      )
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function collectArchiveSummaries(): Promise<ArchiveSummary[]> {
  const archiveFiles = await listArchiveFiles();
  const summaries: ArchiveSummary[] = [];

  for (const fileName of archiveFiles) {
    const fileSummary = await readArchiveSummaryFromFile(fileName);
    if (fileSummary) {
      summaries.push(fileSummary);
    }
  }

  return summaries;
}

async function rewriteArchiveIndex(entries: ArchiveSummary[]): Promise<void> {
  await writeFile(
    transcriptArchiveIndex,
    YAML.stringify({ entries }, { indent: 2 }),
    { encoding: 'utf8' },
  );
}

export interface LoadedTranscript {
  messages: ChatMessage[];
  title: string | undefined;
}

export async function loadTranscript(): Promise<LoadedTranscript> {
  try {
    const raw = await readFile(transcriptPath, 'utf8');
    const parsed = transcriptSchema.parse(YAML.parse(raw));
    return {
      messages: parsed.messages.map(mapTranscriptMessage),
      title: parsed.title,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { messages: [], title: undefined };
    }

    debug(
      `Failed to load current transcript: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { messages: [], title: undefined };
  }
}

export async function saveTranscript(
  messages: ChatMessage[],
  title?: string,
): Promise<void> {
  await ensureAgentHome();
  const output = YAML.stringify(
    { messages, ...(title !== undefined ? { title } : {}) },
    { indent: 2 },
  );
  await writeFile(transcriptPath, output, { encoding: 'utf8' });
}

export async function archiveTranscript(
  messages: ChatMessage[],
  title?: string,
): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  await ensureTranscriptArchiveDir();
  const fileName = createArchiveFileName();
  const output = YAML.stringify(
    { messages, ...(title !== undefined ? { title } : {}) },
    { indent: 2 },
  );
  await writeFile(join(transcriptArchiveDir, fileName), output, {
    encoding: 'utf8',
  });

  const preview = summarizeTranscript(messages);
  const indexEntry = {
    id: fileName,
    messageCount: messages.length,
    preview,
    updatedAt: new Date().toISOString(),
    title,
  };

  try {
    const raw = await readFile(transcriptArchiveIndex, 'utf8');
    const index = archiveIndexSchema.parse(YAML.parse(raw));
    index.entries.push(indexEntry);
    await writeFile(
      transcriptArchiveIndex,
      YAML.stringify(index, { indent: 2 }),
      { encoding: 'utf8' },
    );
  } catch (error) {
    debug(
      `Failed to update archive index incrementally: ${error instanceof Error ? error.message : String(error)}`,
    );
    const summaries = await collectArchiveSummaries();
    const mergedSummaries = [
      ...summaries.filter((entry) => entry.id !== indexEntry.id),
      indexEntry,
    ];
    await rewriteArchiveIndex(mergedSummaries);
  }
}

export async function loadArchivedSummaries(): Promise<ArchiveSummary[]> {
  await ensureTranscriptArchiveDir();

  const archiveFiles = await listArchiveFiles();
  try {
    const raw = await readFile(transcriptArchiveIndex, 'utf8');
    const index = archiveIndexSchema.parse(YAML.parse(raw));
    const indexedEntries = new Map(
      index.entries.map((entry) => [entry.id, entry] as const),
    );
    const summaries: ArchiveSummary[] = [];

    for (const fileName of archiveFiles) {
      const indexedSummary = indexedEntries.get(fileName);
      if (indexedSummary) {
        summaries.push(indexedSummary as ArchiveSummary);
        continue;
      }

      const fileSummary = await readArchiveSummaryFromFile(fileName);
      if (fileSummary) {
        summaries.push(fileSummary);
      }
    }

    return summaries;
  } catch (error) {
    debug(
      `Failed to load archive index: ${error instanceof Error ? error.message : String(error)}`,
    );
    return collectArchiveSummaries();
  }
}

export async function loadTranscriptById(id: string): Promise<LoadedTranscript> {
  if (id === 'current') {
    return await loadTranscript();
  }

  const resolvedPath = resolve(transcriptArchiveDir, id);
  const archiveRoot = resolve(transcriptArchiveDir);
  const relativePath = relative(archiveRoot, resolvedPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Invalid transcript id: ${id}`);
  }

  try {
    const raw = await readFile(resolvedPath, 'utf8');
    const parsed = transcriptSchema.parse(YAML.parse(raw));
    return {
      messages: parsed.messages.map(mapTranscriptMessage),
      title: parsed.title,
    };
  } catch (error) {
    throw new Error(
      `Failed to read transcript "${id}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function listTranscripts(): Promise<
  Array<{
    id: string;
    label: string;
    messageCount: number;
    preview: string;
    updatedAt: string;
    isCurrent: boolean;
    title: string | undefined;
  }>
> {
  const currentTranscript = await loadTranscript();
  const currentMessages = currentTranscript.messages;
  const currentTranscriptEntry = currentMessages.length
    ? [
        {
          id: 'current',
          label: currentTranscript.title ?? 'Current conversation',
          messageCount: currentMessages.length,
          preview: summarizeTranscript(currentMessages),
          updatedAt:
            (await statIfExists(transcriptPath)) ?? new Date(0).toISOString(),
          isCurrent: true,
          title: currentTranscript.title,
        },
      ]
    : [];

  const archiveTranscripts = await loadArchivedSummaries();
  const archivedSummaries = archiveTranscripts.map((transcript) => ({
    id: transcript.id,
    label:
      transcript.title ??
      (transcript.preview.length > 48
        ? `${transcript.preview.slice(0, 45)}...`
        : transcript.preview),
    messageCount: transcript.messageCount,
    preview: transcript.preview,
    updatedAt: transcript.updatedAt,
    isCurrent: false,
    title: transcript.title,
  }));

  return [...currentTranscriptEntry, ...archivedSummaries].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function renameTranscript(title: string): Promise<void> {
  try {
    const raw = await readFile(transcriptPath, 'utf8');
    const parsed = transcriptSchema.parse(YAML.parse(raw));
    const output = YAML.stringify(
      { messages: parsed.messages, ...(title !== undefined ? { title } : {}) },
      { indent: 2 },
    );
    await writeFile(transcriptPath, output, { encoding: 'utf8' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export async function clearTranscript(): Promise<void> {
  try {
    await unlink(transcriptPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }
}
