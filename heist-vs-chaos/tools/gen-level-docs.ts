// Writes docs/LEVELS.md from the campaign data (single source of truth).
import { writeFileSync } from 'node:fs';
import { LEVELS, mistakeDamage } from '../src/shared/levels/campaign.js';
import { validateCampaign } from '../src/shared/levels/validate.js';
import { hintFor, freshRun } from '../src/shared/engine.js';

const { reports } = validateCampaign(LEVELS);
const PH: Record<string, string> = { infiltrate: 'Проникновение', steal: 'Кража', escape: 'Побег' };
let md = '# 30 уровней кампании\n\nФайл создаётся автоматически: `npm run docs:levels` (источник — `src/shared/levels/campaign.ts`).\n\n';
md += 'Урон за ошибку: уровни 1–15 — 1 HP; 16–25 — 2 HP в побеге; 26–30 — 2 HP в краже и побеге. У робота 3 HP.\n\n';
for (const l of LEVELS) {
  const r = reports[l.n - 1]!;
  md += `## ${l.n}. ${l.title} — ${l.wing}\n\n`;
  md += `Экспонат: **${l.exhibit.name}**. ${l.briefing} Решений: ${l.beats.length}. Урон: ${[...new Set(l.beats.map((b) => mistakeDamage(l.n, b.phase)))].join('/')} HP. Достижимых состояний: ${r.reachableStates}.\n\n`;
  md += '| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |\n|---|---|---|---|---|---|\n';
  l.beats.forEach((b, i) => {
    md += `| ${i + 1} | ${PH[b.phase]} | ${b.room.style} | ${b.challenge} ${JSON.stringify(b.cue).replace(/[{}"]/g, '').replace(/\|/g, '/')} | ${b.options.map((o, k) => `${k + 1}) ${o.label}`).join('<br>')} | ${hintFor(b, freshRun()).replace(/\|/g, '/')} |\n`;
  });
  md += `\nИдеальный путь (0 урона): ${r.perfectPath.join(' → ')}\n\n`;
}
writeFileSync('docs/LEVELS.md', md);
console.log('docs/LEVELS.md written');
