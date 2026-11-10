/**
 * The Daily Guide in one call: Observe (context) → Learn → Decide → (Explain) → brief.
 * Acting (nudges, notifications) is done by the hook with the governor's plan.
 */
import { buildBrief } from './brief';
import { buildInsights } from './insights';
import { learnAll } from './learn';
import type { AgentContext, Insight, LearnedPatterns, MorningBrief } from './types';

export interface AgentRun {
  patterns: LearnedPatterns;
  insights: Insight[];
  brief: MorningBrief;
  ranAt: string;
  ms: number;
}

export function runAgent(ctx: AgentContext): AgentRun {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const patterns = learnAll(ctx);
  const insights = buildInsights(ctx, patterns);
  const brief = buildBrief(ctx, patterns, insights);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { patterns, insights, brief, ranAt: ctx.now.toISOString(), ms: Math.round((t1 - t0) * 10) / 10 };
}

export * from './types';
