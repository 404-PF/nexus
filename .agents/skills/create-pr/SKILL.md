---
name: create-pr
description: 'Use when creating a GitHub pull request draft or opening a new PR from a completed change, bug fix, feature, or follow-up.'
---

# Create Pull Request

Use this skill when the user wants to turn verified workspace changes into a clear GitHub pull request.

## Goal

Produce a pull request that is concise, reviewable, and grounded in the actual code changes.

## Workflow

1. Classify the change.
   - Decide whether the work is a bug fix, feature, refactor, documentation update, or maintenance task.
   - Identify the primary user-facing impact if it is obvious.

2. Gather the minimum evidence needed.
   - Inspect the changed files, related tests, and any relevant logs or commands.
   - Prefer concrete scope, behavior changes, validation results, and any known risks.
   - If the branch or change set is unclear, ask targeted questions before drafting the PR.

3. Draft the pull request.
   - Use a clear title that names the change and the affected area.
   - Include a short summary, why the change was made, what changed, and how it was validated.
   - Add notes on risks, follow-ups, or missing verification when relevant.
   - Separate verified facts from assumptions.

4. Create the pull request if requested.
   - Use the GitHub pull request tools available in the workspace when the user asks to open the PR.
   - Set the base branch, head branch, draft state, and maintainer edit permission only when they are known or explicitly requested.

## Quality Check

Before finishing, confirm that the PR draft:

- States the change in one sentence.
- Explains the main reason for the change.
- Describes what was validated.
- Calls out any remaining risk or follow-up work.
- Uses only facts that were verified in the workspace or provided by the user.

## Output Format

When responding, prefer this order:

1. PR title
2. PR draft body
3. Missing information, if any
4. Next action, such as asking a clarifying question or creating the PR
