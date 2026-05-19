import { loadConfig } from './config/persistence.js';
import { runConfigWizard } from './config/wizard.js';
import { runTui } from './tui/run.js';

const argv = new Set(process.argv.slice(2));
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

if (argv.has('--setup') || argv.has('setup') || argv.has('config')) {
  await runConfigWizard(existingConfig ?? undefined);
  process.exit(0);
}

const config = existingConfig ?? (await runConfigWizard());
await runTui(config);
