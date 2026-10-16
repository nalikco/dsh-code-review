import { HELP, parseOptions, resolveConfig } from './options.mjs';
import { collectChanges } from './git.mjs';
import { loadEvidence, assertUnchanged } from './workspace.mjs';
import { normalizeReport, deduplicate, formatReport } from './findings.mjs';
import { LANES, reviewPrompt, validationPrompt } from './prompts.mjs';
import { service } from './services.mjs';

export async function mapBounded(items, concurrency, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; try { results[index] = { status: 'fulfilled', value: await fn(items[index], index) }; } catch (reason) { results[index] = { status: 'rejected', reason }; } }
  }));
  return results;
}

export function createHandler(ctx, rawConfig, reviewer, dependencies = {}) {
  const config = resolveConfig(rawConfig), active = new Map();
  const collect = dependencies.collectChanges ?? collectChanges;
  const stop = () => { for (const controller of active.values()) controller.abort(new Error('Code review plugin unloaded.')); };
  const handler = async ({ agent, rawInput, signal }) => {
    let options;
    try { options = parseOptions(rawInput); } catch (error) { return { kind: 'error', text: error.message }; }
    if (options.help) return { kind: 'success', text: HELP };
    if (active.has(agent.id)) return { kind: 'error', text: 'В этой сессии уже выполняется /code-review.' };
    if (agent.status === 'running') return { kind: 'error', text: 'Дождись завершения текущего хода перед /code-review.' };
    const controller = new AbortController(); active.set(agent.id, controller);
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(config.timeoutMs)]);
    let evidence, findings = [], limitations = [], fix = null, verification = null, stale = false;
    try {
      const scope = agent.ctx;
      const fs = service(scope, 'fs');
      const cwd = agent.session.header.cwd;
      if (!cwd || fs.processPathFromHostPath(cwd) !== cwd) throw new Error('Версия 0.1 поддерживает только локальный host-backed Git workspace.');
      const policy = service(scope, 'sandboxPolicy').resolve({ session: agent.session });
      if (options.fix && policy.mode === 'read-only') throw new Error('--fix не может расширить read-only права сессии. Сначала явно измени режим доступа.');
      const changes = await collect(cwd, options, config, combined);
      if (!changes.files.length) return { kind: 'success', text: 'Нет Git-изменений для review. Автоматический выбор случайных недавних файлов не выполняется.' };
      evidence = await loadEvidence(fs, changes, config, combined);
      const sameChanges = other => other.root === changes.root && other.base === changes.base && other.head === changes.head && other.diff === changes.diff && JSON.stringify(other.files) === JSON.stringify(changes.files) && JSON.stringify([...(other.revisions ?? [])]) === JSON.stringify([...(changes.revisions ?? [])]);
      if (!sameChanges(await collect(cwd, options, config, combined))) throw new Error('Git-изменения изменились при сборе evidence. Повтори команду.');
      await assertUnchanged(fs, evidence, config, combined);
      limitations.push(...evidence.limitations);
      const run = async prompt => normalizeReport(await reviewer(ctx, agent, prompt, combined), evidence, config.maxFindings);
      const reviews = await mapBounded(LANES, 3, lane => run(reviewPrompt(lane, evidence, options, config)));
      for (let i = 0; i < reviews.length; i++) {
        const result = reviews[i];
        if (result.status === 'rejected') limitations.push(`${LANES[i][0]}: ${result.reason.message}`);
        else { findings.push(...result.value.findings); limitations.push(...result.value.limitations); }
      }
      combined.throwIfAborted();
      const candidates = deduplicate(findings); findings = [];
      if (candidates.length > config.maxValidations) limitations.push(`${candidates.length - config.maxValidations} находок не проверены из-за лимита и не включены в подтверждённые.`);
      const validations = await mapBounded(candidates.slice(0, config.maxValidations), 3, async candidate => {
        const report = await run(validationPrompt(candidate, evidence, options));
        if (report.findings.length > 1 || report.findings.some(f => f.id !== candidate.id || f.file !== candidate.file || f.category !== candidate.category || f.side !== candidate.side)) throw new Error('Validator changed candidate identity');
        return report;
      });
      for (const result of validations) {
        if (result.status === 'rejected') limitations.push(`Проверка находки: ${result.reason.message}`);
        else { findings.push(...result.value.findings); limitations.push(...result.value.limitations); }
      }
      findings = deduplicate(findings);
      combined.throwIfAborted();
      try {
        await assertUnchanged(fs, evidence, config, combined);
        if (!sameChanges(await collect(cwd, options, config, combined))) throw new Error('Git diff, HEAD или список файлов изменились во время review.');
      } catch (error) { combined.throwIfAborted(); stale = true; limitations.push(error.message); }
      if (options.fix && !stale) {
        if (!dependencies.scheduleFix) throw new Error('Штатный scheduler исправлений недоступен; host-записи запрещены.');
        combined.throwIfAborted();
        fix = await dependencies.scheduleFix({ agent, evidence, findings, config, signal: combined });
        verification = fix.queued.length ? 'исправления переданы в обычный ход родителя; результаты и частичные записи видны в штатном журнале tools. После завершения повтори /code-review.' : null;
      }
      combined.throwIfAborted();
      return { kind: reviews.every(r => r.status === 'rejected') || fix?.error || stale ? 'error' : 'success', text: formatReport({ evidence, findings, limitations, fix, verification, stale }) };
    } catch (error) {
      const prefix = combined.aborted ? 'Code review отменён или истёк лимит ожидания.' : `Code review остановлен: ${error.message}`;
      return { kind: 'error', text: evidence ? prefix + '\n\n' + formatReport({ evidence, findings, limitations: [...limitations, String(error.message)], fix, verification, stale }) : prefix };
    } finally { active.delete(agent.id); }
  };
  return { handler, stop };
}
