---
name: review-pr
description: 'Use when reviewing a pull request, assessing a diff, or giving code review feedback on a change.'
---

# Review Pull Request

Use this skill when the user wants a code review of a pull request or change set.

## Goal

Produce a review that prioritizes correctness, regressions, test coverage, and actionable feedback.

## Workflow

1. Identify the review target.
   - Confirm the PR, branch, or diff to review.
   - If the target is missing, ask for the PR number, branch name, or changed files.

2. Inspect the smallest useful surface.
   - Read the changed files first, then nearby code that controls the same behavior.
   - Prefer the owning abstraction, related tests, and call sites over broad repository exploration.
   - Focus on behavior, data flow, validation, error handling, and compatibility.

3. Look for review findings.
   - Check for bugs, edge cases, regressions, security issues, broken assumptions, and missing tests.
   - Distinguish blocking issues from style preferences or low-risk observations.
   - Verify claims with concrete evidence from the diff, surrounding code, or execution results when available.

4. Validate the high-risk paths.
   - Use the cheapest focused check that can confirm or disprove a suspected issue.
   - Prefer targeted tests, lint, or build checks for the touched slice.
   - If a finding depends on a missing fact, state the assumption clearly instead of overclaiming.

5. Report the review.
   - Put findings first, ordered by severity.
   - Include file and line references for each finding when possible.
   - Keep the summary short and make the main risk clear.

## Quality Check

Before finishing, confirm that the review:

- Focuses on correctness and user impact before style.
- Separates verified findings from assumptions.
- Includes file references for concrete issues.
- Calls out missing tests or validation gaps when relevant.
- Avoids burying the key issues under a long summary.

## Output Format

When responding, prefer this order:

1. Findings, ordered by severity.
2. Open questions or assumptions.
3. Brief change summary, only if needed.
