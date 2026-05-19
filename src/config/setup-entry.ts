import { runConfigWizard, runProviderSwitcher } from './wizard.js';
import { loadConfig, exportConfig, importConfig } from './persistence.js';

const argv = process.argv.slice(2);
let existingConfig: Awaited<ReturnType<typeof loadConfig>> = null;

try {
  existingConfig = await loadConfig();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    existingConfig = null;
  } else {
    console.warn(
      `Unable to read existing config; opening setup with defaults: ${error instanceof Error ? error.message : String(error)}`,
    );
    existingConfig = null;
  }
}

function hasArg(prefix: string): boolean {
  return argv.some((arg) => arg === prefix || arg.startsWith(`${prefix}=`));
}

function findArgValue(prefix: string): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith(`${prefix}=`)) {
      return arg.slice(prefix.length + 1);
    }
  }

  const index = argv.indexOf(prefix);
  if (index !== -1 && index + 1 < argv.length) {
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      return next;
    }
  }

  return undefined;
}

if (
  hasArg('--provider') ||
  hasArg('provider') ||
  hasArg('switch-provider')
) {
  await runProviderSwitcher(existingConfig ?? undefined);
  process.exit(0);
}

if (hasArg('--backup') || hasArg('--export')) {
  const path = findArgValue('--backup') ?? findArgValue('--export');
  if (!path) {
    console.error(
      'Usage: npm run setup -- --backup|--export <path>',
    );
    process.exit(1);
  }

  try {
    await exportConfig(path);
    console.log(`Config exported to ${path}`);
  } catch (error) {
    console.error(
      `Failed to export config: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  process.exit(0);
}

if (hasArg('--restore') || hasArg('--import')) {
  const path = findArgValue('--restore') ?? findArgValue('--import');
  if (!path) {
    console.error(
      'Usage: npm run setup -- --restore|--import <path>',
    );
    process.exit(1);
  }

  try {
    await importConfig(path);
    console.log(`Config restored from ${path}`);
  } catch (error) {
    console.error(
      `Failed to restore config: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  process.exit(0);
}

await runConfigWizard(existingConfig ?? undefined);
process.exit(0);
