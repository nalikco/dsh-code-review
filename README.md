# DSH Code Review

English | [Русский](README.ru.md)

A `/code-review` command for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), combining correctness/security, reuse/quality and efficiency review. Three read-only reviewers work in parallel, then independent validators check their findings. Source files are not modified by default.

Version **1.0.2**. License: [MIT](LICENSE).

## Requirements and installation

- Node.js22+, Git and a local host-backed Git workspace.
- DSH services `commands`, `agents`, `tools`, `systemPrompt`, `fs` and `sandboxPolicy`. Checked against **0.2.0-rc.2** service packages, Cordis `~4.0.4` and Schemastery `~3.18.4`. These are prerelease APIs; compatibility with other versions is not guaranteed.
- An idle parent agent. Do not register another global command named `code-review` in the same layer.
- Linux/Docker has been tested locally. CI also declares macOS checks. Windows and remote filesystems are not validated.

In DSH, open **Plugins**, choose bundle installation and enter:

```text
https://github.com/nalikco/dsh-code-review.git
```

For a reproducible installation, pin a reviewed commit: `https://github.com/nalikco/dsh-code-review.git#<commit-sha>`. Alternatively clone the repository and install its absolute directory through Plugin Manager.

No build or install scripts are required. `private: true` intentionally prevents accidental npm registry publication; Git/local-directory installation remains supported. Profile-wide installation affects every session in that profile and runs host code with your OS permissions. Inspect the installation result: `restart-required` means a restart is needed. Cloning the repository alone does not change the live profile. Disable or remove the bundle through Plugin Manager to uninstall.

## Usage

```text
/code-review
/code-review --focus "timeout handling"
/code-review --base main
/code-review --fix
/code-review --help
```

| Option | Behavior |
| --- | --- |
| Default | Separate staged and unstaged diffs plus untracked files. An inverse unstaged diff does not hide staged changes. Unborn/orphan branches are supported. |
| `--base <ref>` | Staged changes relative to the merge-base of the ref and HEAD, followed by unstaged changes. Includes untracked files. |
| `--focus "text"` | Additional review topic, not permission to widen scope or access. Quote values containing spaces. |
| `--fix` | Hand validated worktree replacements to a normal parent turn, preserving its tool policies. **Queued does not mean applied.** |
| `--help` | Command help. |

The child model/reasoning route is inherited from the parent's latest logged request, falling back to creation options before the first request. A pending UI model selection is not used until it becomes effective in the parent request.

## Review pipeline

1. Collect per-file Git diffs, full worktree/index/base snapshots and scoped `AGENTS.md`/`CLAUDE.md` files. Full snapshots stay host-side for coordinates/freshness, not repeated in model prompts. Prompts contain diffs, numbered untracked contents, version metadata and applicable instructions. Whole-file bundles are packed deterministically under `maxDiffBytes` (default500000 bytes per batch), up to `maxReviewBatches` (default8). Staged and unstaged sides stay together. An oversized individual bundle/file or excessive batch count fails before model work; nothing is silently truncated. Binary, symlink and inaccessible files have explicit limited coverage.
2. Run three independent read-only reviewers: correctness/security, reuse/quality and efficiency. They may inspect context with `read`, `glob` and `grep`, but cannot run shell commands, delegate, access MCP tools, write source files or escalate permissions.
3. Deduplicate and independently validate findings with at most three validators in flight. Bugs and improvements are reported separately. Findings identify their `worktree`, `index` or `base` coordinates. Invalid findings do not discard valid siblings; higher-severity candidates are retained.
4. Recheck diffs, HEAD, changed files, versions and instruction snapshots. A changed scope returns an error and a provisional report; no fix is handed off.

The command report is outside model history. Only explicit `--fix` delivers proposals to the parent. Review children are one-shot and do not use the standard continuable-subagent catalog.

## Policy-preserving fixes

`--fix` **does not write through host filesystem APIs**. After review, exact validated replacements are submitted to a normal parent turn. The parent reads the files and uses its existing `edit` tool. Existing Auto review, pre-execute decisions, monotonic guards, observations and downstream freshness policies remain authoritative.

A successful slash command means the proposals were **queued**, not that edits completed. Actual edits and partial results appear in the normal tool log, including on cancellation. After the parent turn, run `/code-review` again and run the relevant project tests separately. There is no automatic post-fix review.

- Fix handoff is refused in read-only, active/pending plan mode and PTC-only presentation. Native/both presentation needs the standard `edit` tool.
- The fix turn is narrowed to reads and exact validated edits. Shell, delegation, escalation, publication and unrelated edits are denied. A tool failure stops further mutations. Cancellation/unload cancels the fix without clearing unrelated queued user input.
- Only existing changed worktree files are eligible. No file creation/deletion, instruction-file changes or cross-file fixes. Index/base findings are report-only.
- Auto may refuse a fix requiring additional human authority. Machine-generated replacement data is not disguised as a new authenticated human instruction.
- **Do not edit the worktree concurrently with `--fix`.** SDK version checks are not atomic compare-and-swap against an external editor: a window remains between version probe and atomic rename. There is no multi-file transaction or automatic rollback. LLM validation does not guarantee a correct patch.

Version 1.0.0 is the initial public release. Earlier 0.1.x builds were unpublished development prototypes; see [CHANGELOG.md](CHANGELOG.md).

## Data and security

Diffs, source snapshots, instructions and context read by reviewers are sent to the session's configured LLM provider and may persist in DSH session/spill storage. Do not review secrets or proprietary code without the appropriate authorization. This plugin adds no telemetry endpoint or model provider. Read [SECURITY.md](SECURITY.md) before installing.

Host Git runs without a shell. Inherited `GIT_*` overrides are cleared, hooks/fsmonitor disabled, lazy fetch disabled and submodule diffs forced short/nonrecursive. Clean/process filters and partial-clone fetching are refused. The installed Git, configuration files and other host plugins are trusted; same-user malicious processes racing local configuration are outside the threat model.

No PR support, GitHub comments, commit/push, automated project tests/typecheck/lint or recursive submodule review. Read-only means no source-file changes, not zero writes to ordinary DSH logs/spill files. Instructions outside the repository depend on the normal preset composition. LLM review supplements rather than replaces tests and human review.

## Configuration

The bundle row is `code-review`:

```yaml
- insert:
    - id: code-review
      name: dsh-code-review
      config:
        maxFiles: 80
        maxDiffBytes: 500000
        maxFileBytes: 250000
        maxReviewBatches: 8
        maxFindings: 18
        maxValidations: 12
        timeoutMs: 600000
```

Fields are positive integers capped at four times their defaults. Concurrency is fixed at three per command across all batch/lane tasks. Cost is three reviewers per batch plus up to12 validators total per command; `--fix` adds a normal parent turn. Session-model review can be expensive. Timeout/cancellation applies to the associated work.

## Development and verification

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

`npm test` has no SDK dependency. Integration tests install public npm SDK packages, not a private extracted Desktop checkout. They exercise real DSH services, Git and filesystem operations with scripted LLM adapters. Auto is tested with a policy-deny fixture, not a live risk model. Live-model quality, live GUI rendering and every provider/preset combination are not established by these tests. See [CONTRIBUTING.md](CONTRIBUTING.md).

Inspired by the [official code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) and a [published Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Not affiliated with Anthropic; this package implements its own prompts and execution policy.
