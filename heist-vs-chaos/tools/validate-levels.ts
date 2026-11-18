import { LEVELS } from '../src/shared/levels/campaign.js';
import { validateCampaign } from '../src/shared/levels/validate.js';

const { reports, errors } = validateCampaign(LEVELS);
for (const r of reports) {
  console.log(
    `L${String(r.n).padStart(2)} ${r.decisions} decisions  options ${r.optionsPerBeat.join('')}  states ${String(r.reachableStates).padStart(4)}  ` +
      `mistakes-to-lose ${r.worstCaseMistakesToLose}  perfect: ${r.perfectPath.join(' > ')} (alert ${r.perfectRunAlarm})`,
  );
}
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('\nAll 30 levels valid.');
