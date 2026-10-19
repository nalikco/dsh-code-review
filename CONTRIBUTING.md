# Development

Use Node22 or24. Install public SDK test dependencies and run:

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

The implementation is intentionally small: `index.mjs` registers the command and native skill, `options.mjs` parses arguments, `prompt.mjs` loads the readable `REVIEW_PROMPT.md` as skill content and renders the queued invocation with the native `renderSkillContent` plus mode/base/focus parameters. The queued message is stamped `source.kind: 'skill-invocation'`; never attribute review text to the user or reintroduce the `/name` gesture scanner path. Parameter slashes stay escaped in JSON as defense in depth. Do not rebuild a separate Git/review/fix orchestration engine here.

Unit tests use normal message creation and a stub current agent. Integration tests mount real Cordis/DSH service fibers and use a scripted model adapter to verify prompt delivery, help, busy-agent queueing and unload. The package check installs a real tarball in a fresh consumer and verifies registration/handoff. No test mutates a DSH profile or calls a live model. CI declares Linux/macOS × Node22/24; local passes do not imply hosted CI has passed.

Changes to review behavior should normally be made in the prompt. Keep analysis-only as an explicit instruction, fixes opt-in, findings evidence-based and project policies authoritative. Do not claim that prompt instructions are enforced security boundaries. Keep English/Russian docs aligned with actual behavior.

Before release, inspect the full diff and packed file list for private data, run tests and package activation, update the version/changelog and obtain explicit maintainer approval before push/tag/publication. The package remains `private:true` to prevent accidental npm publish; Git installation is supported. Publication and updating a running DSH profile are separate actions.

Security reports: [SECURITY.md](SECURITY.md).
