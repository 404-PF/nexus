import { mkdir, readFile, writeFile, access, copyFile } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { randomUUID } from 'crypto';
import YAML from 'yaml';
import type { AppConfig } from '../core/types.js';
import { createDefaultConfig, parseConfig } from './schema.js';

export const agentHomeDir = join(homedir(), '.agent');
export const configPath = join(agentHomeDir, 'config.yaml');

async function ensureAgentHome(): Promise<void> {
  await mkdir(agentHomeDir, { recursive: true });
}

export async function loadConfig(): Promise<AppConfig | null> {
  try {
    const raw = await readFile(configPath, 'utf8');
    return parseConfig(YAML.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureAgentHome();
  const output = YAML.stringify(config, { indent: 2 });
  await writeFile(configPath, output, { encoding: 'utf8' });
}

export async function loadOrCreateConfig(): Promise<AppConfig> {
  return (await loadConfig()) ?? createDefaultConfig();
}

export async function exportConfig(exportPath: string): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    throw new Error('No config found to export. Run setup first.');
  }

  const absolutePath = resolve(exportPath);
  await mkdir(dirname(absolutePath), { recursive: true });

  const output = YAML.stringify(config, { indent: 2 });
  try {
    await writeFile(absolutePath, output, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `Target file already exists: ${absolutePath}. Remove it or choose a different path.`,
      );
    }
    throw error;
  }
}

export async function importConfig(importPath: string): Promise<void> {
  const absolutePath = resolve(importPath);

  try {
    await access(absolutePath);
  } catch {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const raw = await readFile(absolutePath, 'utf8');

  let config: AppConfig;
  try {
    config = parseConfig(YAML.parse(raw));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid config file: ${message}`,
    );
  }

  const existing = await loadConfig();
  if (existing) {
    const backupName = `config.yaml.backup.${randomUUID()}`;
    try {
      await copyFile(configPath, join(agentHomeDir, backupName));
    } catch (error) {
      throw new Error(
        `Failed to backup existing config before import: ${(error as Error).message}`,
      );
    }
  }

  await saveConfig(config);
}
