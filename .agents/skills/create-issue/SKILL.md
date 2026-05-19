---
name: create-issue
description: 'Use when creating a GitHub issue draft or opening a new issue from a bug report, feature request, task, or follow-up.'
---

# Create Issue

Use this skill when the user wants to turn a problem, request, or follow-up into a clear GitHub issue.

## Goal

Produce an issue that is concise, actionable, and grounded in verified evidence from the workspace.

## Workflow

1. Classify the request.
   - Decide whether it is a bug, feature request, task, regression, or documentation follow-up.
   - Identify the intended audience if it is obvious: maintainer, contributor, or end user.

2. Gather the minimum evidence needed.
   - Inspect the relevant files, commands, logs, or tests.
   - Prefer concrete reproduction steps, affected paths, expected behavior, and actual behavior.
   - If key facts are missing, ask targeted questions before drafting the issue.

3. Draft the issue.
   - Use a clear title that names the problem and the affected area.
   - Include a short summary, impact, reproduction steps, expected vs actual behavior, and any relevant notes.
   - Add acceptance criteria when the issue is actionable work.
   - Separate verified facts from assumptions.

4. Create the issue if requested.
   - Use the GitHub issue tools available in the workspace when the user asks to open the issue.
   - Apply labels, assignees, milestone, and issue type only when they are known or explicitly requested.

## Quality Check

Before finishing, confirm that the issue draft:

- States the problem in one sentence.
- Includes enough context for another person to act on it.
- Avoids speculation unless it is labeled as such.
- Uses only facts that were verified in the workspace or provided by the user.

## Output Format

When responding, prefer this order:

1. Issue title
2. Issue draft body
3. Missing information, if any
4. Next action, such as asking a clarifying question or creating the issue
