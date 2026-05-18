import { runConfigWizard, runProviderSwitcher } from './wizard.js';
import { loadConfig } from './persistence.js';

const argv = new Set(process.argv.slice(2));
let existingConfig: Awaited<ReturnType<typeof loadConfig>> = null;

try {
	existingConfig = await loadConfig();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
		existingConfig = null;
	} else {
		console.warn(
			`Unable to read existing config; opening setup with defaults: ${error instanceof Error ? error.message : String(error)}`
		);
		existingConfig = null;
	}
}

if (argv.has('--provider') || argv.has('provider') || argv.has('switch-provider')) {
  await runProviderSwitcher(existingConfig ?? undefined);
  process.exit(0);
}

await runConfigWizard(existingConfig ?? undefined);
process.exit(0);
await runConfigWizard(existingConfig ?? undefined);
process.exit(0);
