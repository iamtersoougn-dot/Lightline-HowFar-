// Prints what the Daily Guide says at each demo time. Run: npm run demo:print
import { buildDemoWorld, DEMO_TIMES } from '../src/agent/demo';
import { runAgent } from '../src/agent/agent';
import { planNudges, recordBrief } from '../src/agent/governor';
import { DEFAULT_SETTINGS, EMPTY_GOVERNOR } from '../src/agent/store';
import { answerOnDevice } from '../src/agent/chat';

const lang = (process.argv[2] === 'pcm' ? 'pcm' : 'en') as 'en' | 'pcm';
for (const t of DEMO_TIMES) {
  const { ctx } = buildDemoWorld(new Date(), t.hour, t.minute, { ...DEFAULT_SETTINGS, language: lang });
  const run = runAgent(ctx);
  console.log(`\n===== ${ctx.now.toDateString()} ${t.label}: ${t.story}  (agent ran in ${run.ms}ms, ${ctx.journal.length} events)`);
  console.log(run.brief.greeting);
  for (const l of run.brief.lines) console.log(`  ${l.label}: ${l.text}`);
  console.log('-- suggestions');
  for (const i of run.insights) console.log(`  [P${i.priority} ${Math.round(i.confidence * 100)}%] ${lang === 'pcm' ? i.titlePcm : i.title}\n      why: ${i.why}`);
  // As in the app's demo mode: the 6am brief has been seen before later times
  const morning = buildDemoWorld(new Date(), 6, 0, ctx.settings).ctx;
  const gov = t.hour > 6 ? recordBrief(EMPTY_GOVERNOR, runAgent(morning).insights, morning.now) : EMPTY_GOVERNOR;
  const plan = planNudges(run.insights, gov, ctx.settings, ctx.now);
  console.log('-- nudges', plan.scheduled.map((s) => `${s.at.toTimeString().slice(0, 5)} ${s.insight.kind}`), 'held:', plan.deferred.map((d) => `${d.insight.kind}: ${d.reason}`));
  if (t.hour === 12) {
    for (const q of ['How much fuel I go need this week?', 'Is my bank working?', 'When will light go tonight?']) {
      const a = answerOnDevice(q, ctx, run.patterns, run.insights);
      console.log(`  Q: ${q}\n  A [${a.intent}/${a.lang}]: ${a.text}\n     why: ${a.why}`);
    }
  }
}
