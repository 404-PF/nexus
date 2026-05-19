import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
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
  const dir = join(absolutePath, '..');
  await mkdir(dir, { recursive: true });

  const output = YAML.stringify(config, { indent: 2 });
  await writeFile(absolutePath, output, { encoding: 'utf8' });
}

export async function importConfig(importPath: string): Promise<void> {
  const absolutePath = resolve(importPath);

  try {
    await access(absolutePath);
  } catch {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const raw = await readFile(absolutePath, 'utf8');
  const config = parseConfig(YAML.parse(raw));
  await saveConfig(config);
}
