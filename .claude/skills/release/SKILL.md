---
name: release
description: Create a release PR from a staging branch into main. Never touches the current branch or local working tree changes.
version: 0.2.0
model: sonnet
---

# release

Create a release Pull Request from a staging branch into `main`.

**The current branch and any local working tree changes are never touched.**
All git introspection is done by reading the remote state directly.

## Purpose

Automates the release PR workflow:

1. Identify the source (staging) branch and confirm it exists on the remote.
2. Detect all changes between the staging branch and `main` on the remote.
3. Scan for breaking changes and surface them prominently.
4. Create or update a PR from staging → `main` with a structured release description.

## Instructions

### Step 1: Determine Source Branch

- **Source branch** — a branch name passed as an argument (e.g. `/release staging`). If no argument is given, ask the user which branch to release.
- **Target branch** — always `main`.

Do **not** use the current local branch as the source. Do **not** check out or switch to any branch.

Confirm the source branch exists on the remote:

```bash
git ls-remote --heads origin <source-branch>
```

If it does not exist, stop and tell the user.

If source branch equals `main`, stop and tell the user to specify a different branch.

### Step 2: Validate Remote Branch State

Do **not** modify the working tree or index. All checks run against the remote refs fetched below.

```bash
git fetch origin main <source-branch>
```

Then run these checks in parallel:

1. **Up to date** — confirm `origin/<source-branch>` and the local tracking ref (if any) agree. If the remote is ahead of local, note it but do not pull.
2. **No conflicts** — verify the source branch can be merged into `main` without conflicts:
   ```bash
   git merge-tree $(git merge-base origin/main origin/<source-branch>) origin/main origin/<source-branch>
   ```
   If conflicts are found, list the conflicting files and stop.
3. **Lint** — run the project linter (e.g. `npm run lint`) against the current working tree as a proxy for branch quality. Report findings; do not auto-fix.
4. **Tests** — run the project test suite (e.g. `npm test`) against the current working tree. If tests fail, report failures and ask the user whether to continue.

### Step 3: Collect All Changes

Collect diffs and commits between `origin/main` and `origin/<source-branch>` — never against local HEAD:

```bash
git log --oneline origin/main..origin/<source-branch>
git diff origin/main..origin/<source-branch>
```

Read every commit and every changed file. Build a complete picture of what this release contains before writing the PR description.

### Step 4: Detect Breaking Changes

Scan the diff carefully for:

- Removed or renamed public exports, functions, classes, or types
- Changed method signatures (parameter names/types/order, return types)
- Removed or renamed configuration keys or environment variables
- Changed default values that callers depend on
- Changed behavior that existing callers rely on (error types, event names, response shapes, HTTP status codes)
- Major version bumps in dependencies that themselves carry breaking changes
- Database schema changes that require migration (dropped columns, renamed tables, non-null constraints added)

Note every breaking change found, including the migration path for each.

### Step 5: Determine Version Bump

Based on the changes found:

- **Major** — any breaking changes detected.
- **Minor** — new features, new exports, or new capabilities; no breaking changes.
- **Patch** — bug fixes, documentation, refactoring, dependency updates only.

Report the recommended version bump to the user. If the project uses `npm version` or a similar tool, note the relevant command (e.g. `npm run deploy:major`) but do **not** run it — version bumping is the user's decision.

### Step 6: Create or Update the Release PR

Check whether a PR from the source branch into `main` already exists:

```bash
gh pr list --head <source-branch> --base main --json number,url,state
```

**If no PR exists** — create one with `gh pr create --base main --head <source-branch>`.
**If a PR exists** — update its title and body via `gh api repos/{owner}/{repo}/pulls/{number} -X PATCH`.

#### PR Title

Format: `release: <source-branch> → main` (e.g. `release: staging → main`).

If the branch name is a version (e.g. `release/1.2.0`), use: `release: v1.2.0`.

#### PR Description

Build the description in this order:

---

**If any breaking changes were found**, open with:

```markdown
## ⚠️ Breaking Changes

- <change 1> — <migration path>
- <change 2> — <migration path>
```

---

Then always include:

```markdown
## Summary

<2–4 sentences: what this release does and why it's going out now>

## What's Included

<Grouped list of changes by type. Each bullet is one logical change, not one commit. Synthesize; don't dump git log.>

### Features
- ...

### Fixes
- ...

### Internal / Refactoring
- ...

### Dependencies
- ...

### Documentation
- ...

(Omit sections that have no entries.)

## Release Notes

User-facing changelog entry for this release. Written for consumers of the package/service, not for internal reviewers. Rules:

- Use plain language — no internal jargon, no PR numbers, no commit hashes.
- Lead with what changed from the user's perspective, not how it was implemented.
- Group under **Added**, **Changed**, **Fixed**, **Removed** (omit empty groups).
- If a change has a breaking counterpart already listed in ⚠️ Breaking Changes, reference it here under **Changed** or **Removed** with a one-line migration hint.
- Keep each bullet to one sentence.

Example:

```markdown
## Release Notes

### Added
- `EmitterModule.forFeature({ logger })` — override the error logger per module without affecting the rest of the app.

### Changed
- `@OnEmitterEvent` now prefers the feature-level logger over the root logger when both are present.

### Fixed
- Listener errors in async handlers no longer propagate and crash the emitter loop.
```

## Risks

<Deployment concerns, rollback considerations, migration steps required, third-party service dependencies, feature flags to toggle. If none: "None — all changes are backward-compatible.">

## Recommended Version Bump

`<major | minor | patch>` — <one sentence justification>

To publish: `<deploy command, e.g. npm run deploy:minor>`

## Test Plan

- [ ] All unit tests pass (`npm test`)
- [ ] Linting clean (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] <any manual verification steps specific to the changes>
- [ ] Verify no regressions in <key user-facing flows>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

### Step 7: Report Output

Provide:

- Source branch and commit range (`origin/main..origin/<source-branch>`).
- Number of commits and files changed.
- Breaking changes found (or "none").
- Recommended version bump.
- PR URL.
- Any lint/test issues encountered.
- Next step for the user (e.g. review and merge, then run `npm run deploy:minor`).

## Success Criteria

The release PR should:

- Be created from the remote source branch — local branch and working tree are untouched.
- Reflect the complete set of changes between `origin/main` and `origin/<source-branch>`.
- Surface any breaking changes prominently at the top.
- Include a clear version bump recommendation with the deploy command.
- Have a test plan that a reviewer can actually follow.
- Be mergeable (no conflicts with `main`).
