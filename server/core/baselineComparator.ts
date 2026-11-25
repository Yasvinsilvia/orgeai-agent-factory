import type {
  AgentDefinition,
  BaselineHeadToHeadItem,
  DocumentChunk,
  EvalCaseResult,
  EvalTestCase,
  HumanBaselineComparison,
} from '../../src/types/forge.ts';
import { computeOverallScore } from './criticOptimizer.ts';
import { BudgetTracker } from './gemini.ts';
import { evaluateAgentOnSuite } from './judge.ts';
import type { CsvTableSource } from './tools.ts';

export function getDefaultHumanBaselinePrompt(agent: AgentDefinition): string {
  return `You are a helpful ${agent.agent_name} for ${agent.target_audience}.
Answer user questions clearly and concisely using the provided documents.
If a question is unrelated to the documents, politely say you cannot answer it.
Include the document name when possible.`;
}

export async function runFactoryVsHumanBaseline(params: {
  factoryAgent: AgentDefinition;
  factoryResults: EvalCaseResult[];
  testCases: EvalTestCase[];
  chunks: DocumentChunk[];
  csvSources: CsvTableSource[];
  customHumanPrompt?: string;
}): Promise<HumanBaselineComparison> {
  const humanPrompt =
    params.customHumanPrompt?.trim() || getDefaultHumanBaselinePrompt(params.factoryAgent);

  // Hand-written human baseline typically uses default naive retrieval settings (top_k=3, chunk_size=700)
  const humanAgent: AgentDefinition = {
    ...params.factoryAgent,
    id: `${params.factoryAgent.id}_human_baseline`,
    agent_name: `Human Baseline (${params.factoryAgent.agent_name})`,
    system_prompt: humanPrompt,
    retrieval_config: {
      chunk_size: 700,
      chunk_overlap: 100,
      top_k: 3,
      similarity_threshold: 0.25,
    },
    status: 'baseline_human',
  };

  const tracker = new BudgetTracker();
  const humanResults = await evaluateAgentOnSuite({
    agent: humanAgent,
    testCases: params.testCases,
    chunks: params.chunks,
    csvSources: params.csvSources,
    tracker,
  });

  const factoryScore = computeOverallScore(params.factoryResults);
  const humanScore = computeOverallScore(humanResults);

  const factoryMap = new Map(params.factoryResults.map((r) => [r.test_id, r]));
  const factory_wins: BaselineHeadToHeadItem[] = [];
  const human_wins: BaselineHeadToHeadItem[] = [];
  let ties = 0;

  for (const hr of humanResults) {
    const fr = factoryMap.get(hr.test_id);
    if (!fr) continue;

    if (fr.passed && !hr.passed) {
      factory_wins.push({
        test_id: fr.test_id,
        question: fr.question,
        category: fr.category,
        factory_score: fr.scores.overall,
        human_score: hr.scores.overall,
        reason: `Factory passed while Human Baseline failed (${hr.failure_category}: ${hr.failure_explanation})`,
      });
    } else if (!fr.passed && hr.passed) {
      human_wins.push({
        test_id: hr.test_id,
        question: hr.question,
        category: hr.category,
        factory_score: fr.scores.overall,
        human_score: hr.scores.overall,
        reason: `Human Baseline passed while Factory failed (${fr.failure_category}: ${fr.failure_explanation})`,
      });
    } else {
      ties += 1;
    }
  }

  const delta = Number((factoryScore - humanScore).toFixed(1));
  const summary =
    delta > 0
      ? `ForgeAI outperformed the hand-written human baseline by +${delta}% (${factory_wins.length} head-to-head wins vs ${human_wins.length} losses), driven by Groundability Guard refusal boundaries and higher top-k retrieval tuning.`
      : delta < 0
      ? `The hand-written human baseline outperformed ForgeAI by ${Math.abs(delta)}% (${human_wins.length} wins vs ${factory_wins.length} losses), showing where concise human instructions beat automated prompt patches.`
      : `ForgeAI and the hand-written human baseline tied at ${factoryScore}% overall pass rate (${factory_wins.length} factory wins, ${human_wins.length} human wins).`;

  return {
    agent_id: params.factoryAgent.id,
    human_baseline_name: humanAgent.agent_name,
    human_system_prompt: humanPrompt,
    human_score: humanScore,
    factory_score: factoryScore,
    factory_wins,
    human_wins,
    ties,
    summary,
    compared_at: new Date().toISOString(),
  };
}
