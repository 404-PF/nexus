# Agent Instructions

This repository is a Node 24+ TypeScript ESM project with an Ink-based TUI and MCP integration. Keep guidance concise and prefer linking to the source of truth instead of repeating docs.

## Working Rules

- Use `npm install` to set up dependencies.
- Use `npm run setup` to launch the config wizard.
- Use `npm run dev` for local development, `npm run build` for typechecking/build output, and `npm run lint` for validation.
- There is no dedicated test script in `package.json`; use lint and build as the primary checks.
- Keep TypeScript imports ESM-compatible, including `.js` extensions in source imports where required.
- Treat user-local `agent.config.yaml` as a possible source of behavior differences; it is ignored by git and can override default provider settings.
- On Windows, `keytar` may fail to build offline; keep it optional and rely on the local vault fallback.

## Where To Look

- Project overview and startup flow: [README.md](README.md)
- App entry and setup gate: [src/index.ts](src/index.ts)
- Config schema and defaults: [src/config/schema.ts](src/config/schema.ts)
- Config persistence and wizard flow: [src/config/persistence.ts](src/config/persistence.ts) and [src/config/setup-entry.ts](src/config/setup-entry.ts)
- Agent loop and tool orchestration: [src/core/agent-loop.ts](src/core/agent-loop.ts)
- Tool registry and MCP bridge: [src/tools/registry.ts](src/tools/registry.ts) and [src/tools/mcpBridge.ts](src/tools/mcpBridge.ts)
- Provider auth and secret resolution: [src/providers/auth.ts](src/providers/auth.ts)
- TUI session state and transcript handling: [src/tui/session.ts](src/tui/session.ts) and [src/core/state-manager.ts](src/core/state-manager.ts)

## Debugging Notes

- If the TUI behaves unexpectedly after submission, check for local config overrides before changing keyboard or rendering code.
- The last transcript is restored from `~/.agent/history.yaml` on startup, and `New chat` clears both in-memory state and the saved transcript; see [README.md](README.md) for the user-facing behavior.
- For Windows/pwsh smoke tests, `return` is the Enter path and `\u001b[C` is the right-arrow sequence observed in the TUI.
