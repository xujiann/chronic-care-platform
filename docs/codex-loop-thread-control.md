# Codex loop thread control

Updated: 2026-07-01

This note records the coordination rule for continuing all project threads without turning the work into one large mixed change.

## Scope

The active project development scope is `chronic-care-platform` plus the eight application worktrees under `.codex-health-app-worktrees`.

Covered thread groups:

- Main platform integration and release evidence.
- Priority applications 1-8: regional data sharing, referral teleconsultation, quality safety, operations dispatch, drug and consumable supervision, chronic follow-up, research sandbox, and health dashboard.
- Cross-cutting product threads: doctor multi-practice, maternal-child certificates and statistics, resident login/navigation, escort services, system flow documentation, platform audit, and static/dynamic architecture assessment.

Non-project automation or research threads, such as Dalian daily activity recommendations, Notion research, and external policy collection, stay outside this development loop unless explicitly pulled into the project.

## Loop Rule

Each thread should continue in its own checkout or worktree and follow the same small-batch loop:

1. Confirm working directory, branch, and `git status`.
2. Write a short local plan.
3. Make one small, reviewable change.
4. Run the matching checks, usually `npm.cmd run check`, `npm.cmd test`, and the relevant readiness, release, or deploy script.
5. Observe failures, fix them, and rerun the smallest useful command.
6. Update docs, release reports, or acceptance notes only for the change just made.
7. Repeat until that thread's acceptance gate is green.

## Acceptance Notes

- Worktree threads must not edit another application's worktree.
- Main-platform changes should reuse the existing `server.js`, state, API, role UI, readiness, and release-report seams.
- A thread is not ready to report completion until it includes file-level changes, validation results, residual risks, and the next site-integration boundary.
- If a readiness script passes but `release:report` fails, treat `release:report` as the stricter gate and check persisted demo data before broadening the change.
