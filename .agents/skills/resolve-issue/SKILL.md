---
name: resolve-issue
description: 'Use when a user wants to investigate, reproduce, fix, and validate a bug or issue in the workspace.'
---

# Resolve Issue

Use this skill when the user wants a concrete workflow for taking an issue from report to verified fix.

## Goal

Produce a small, verified change that addresses the reported problem and explains what was changed, why, and how it was checked.

## Workflow

1. Classify the issue.
   - Decide whether the problem is a bug, regression, missing behavior, or unclear requirement.
   - Identify the likely user impact and the affected area of the codebase.

2. Gather the minimum evidence needed.
   - Inspect the relevant files, tests, logs, and any reproduction steps.
   - Prefer concrete symptoms, expected behavior, actual behavior, and the narrowest code path that could control the result.
   - If key facts are missing, ask targeted questions before making a broad change.

3. Reproduce or disprove the failure.
   - Run the cheapest focused check available.
   - If the issue is not reproducible, narrow the hypothesis before changing code.

4. Fix the root cause.
   - Make the smallest change that corrects the behavior.
   - Prefer the owning abstraction over surface-level patches.
   - Keep the change aligned with the existing style and public API.

5. Validate the fix.
   - Run the narrowest relevant test, build, lint, or typecheck command.
   - If validation fails, repair the same slice before widening scope.

6. Report the result.
   - Summarize the issue, the fix, and the validation performed.
   - Call out any remaining risks, assumptions, or follow-up work.

## Quality Check

Before finishing, confirm that the resolution:

- Addresses the reported symptom directly.
- Is supported by a local reproduction, focused test, or equivalent evidence.
- Changes the smallest reasonable surface area.
- Includes validation that exercises the touched path.
- Clearly states any unresolved ambiguity or residual risk.

## Output Format

When responding, prefer this order:

1. Short issue summary
2. What changed
3. How it was validated
4. Any remaining questions or risks
5. Next action, if one is needed
