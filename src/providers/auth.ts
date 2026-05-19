import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { ProviderKind } from '../core/types.js';
import { getProviderLabel, getProviderSecretEnvVars } from './catalog.js';

export interface ProviderSecret {
  apiKey: string;
  source: 'env' | 'keychain' | 'file';
}

interface KeyVaultRecord {
  version: 1;
  providers: Partial<
    Record<ProviderKind, { apiKey: string; updatedAt: string }>
  >;
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
}

const serviceName = 'nexus-agi';
const keyVaultPath = join(homedir(), '.agent', 'keys.json');

async function ensureVaultDir(): Promise<void> {
  await mkdir(join(homedir(), '.agent'), { recursive: true });
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    return (await import('keytar')) as unknown as KeytarLike;
  } catch {
    return null;
  }
}

async function readVault(): Promise<KeyVaultRecord> {
  try {
    const raw = await readFile(keyVaultPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<KeyVaultRecord>;
    return {
      version: 1,
      providers: parsed.providers ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        version: 1,
        providers: {},
      };
    }

    throw error;
  }
}

async function writeVault(vault: KeyVaultRecord): Promise<void> {
  await ensureVaultDir();
  await writeFile(keyVaultPath, `${JSON.stringify(vault, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function resolveProviderSecret(
  provider: ProviderKind,
): Promise<ProviderSecret | null> {
  for (const envVar of getProviderSecretEnvVars(provider)) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return {
        apiKey: value,
        source: 'env',
      };
    }
  }

  const keytar = await loadKeytar();
  if (keytar) {
    const value = await keytar.getPassword(serviceName, provider);
    if (value) {
      return {
        apiKey: value,
        source: 'keychain',
      };
    }
  }

  const vault = await readVault();
  const entry = vault.providers[provider];
  if (entry) {
    return {
      apiKey: entry.apiKey,
      source: 'file',
    };
  }

  return null;
}

export async function storeProviderApiKey(
  provider: ProviderKind,
  apiKey: string,
): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(serviceName, provider, apiKey);
      return;
    } catch {
      // fall back to the local vault
    }
  }

  const vault = await readVault();
  vault.providers[provider] = {
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  await writeVault(vault);
}

export function getProviderAuthMessage(provider: ProviderKind): string {
  const label = getProviderLabel(provider);
  const envVars = getProviderSecretEnvVars(provider);
  return `No API key found for ${label}. Checked ${envVars.join(' or ')}, then the OS keychain, then ~/.agent/keys.json. Set one of the env vars, store a key in the keychain, or run npm run setup.`;
}
