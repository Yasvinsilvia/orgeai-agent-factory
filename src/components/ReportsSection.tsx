import { useState } from 'react';
import { Download, Loader2, Play, ShieldCheck } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compareWithHumanBaseline } from '../lib/api';
import type { AgentWorkspaceBundle } from '../types/forge';

interface ReportsSectionProps {
  bundle: AgentWorkspaceBundle | null;
  onBundleUpdated?: (bundle: AgentWorkspaceBundle) => void;
}

export function ReportsSection({ bundle, onBundleUpdated }: ReportsSectionProps) {
  const [customPrompt, setCustomPrompt] = useState(
    bundle?.baseline_comparison?.human_system_prompt ??
      (bundle
        ? `You are a helpful ${bundle.agent.agent_name} for ${bundle.agent.target_audience}. Answer questions using the uploaded documents. If something is missing, say you do not know.`
        : '')
  );
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  if (!bundle || !bundle.quality_report) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        No quality report available yet for this agent.
      </div>
    );
  }

  const r = bundle.quality_report;
  const integrity = r.pipeline_integrity;
  const baseline = bundle.baseline_comparison;

  const chartData =
    r.iterations.length > 0
      ? [
          { stage: 'Baseline', score: r.iterations[0].previous_score },
          ...r.iterations.map((it) => ({
            stage: `Iter ${it.iteration}`,
            score: it.new_score,
          })),
        ]
      : [{ stage: 'Final', score: r.overall_score }];

  const dimensionData = [
    { metric: 'Grounding', pct: r.grounding_score },
    { metric: 'Correctness', pct: r.correctness_score },
    { metric: 'Refusal Acc.', pct: r.refusal_accuracy },
    { metric: 'Citation Acc.', pct: r.citation_accuracy },
    { metric: 'Relevance', pct: r.relevance_score },
  ];

  async function handleRunBaselineComparison() {
    if (!bundle || comparing) return;
    setComparing(true);
    setCompareError(null);
    try {
      const res = await compareWithHumanBaseline(bundle.agent.id, customPrompt);
      onBundleUpdated?.(res.bundle);
    } catch (err: unknown) {
      setCompareError(err instanceof Error ? err.message : 'Baseline comparison failed.');
    } finally {
      setComparing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Honest Quality Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Verified scorecard for <span className="font-medium text-slate-800">{r.agent_name}</span> ·{' '}
            {r.total_cases} evaluation cases · Generated {new Date(r.generated_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const exportPayload = {
                exported_at: new Date().toISOString(),
                agent_definition: bundle.agent,
                configuration: {
                  retrieval_config: bundle.agent.retrieval_config,
                  selected_tools: bundle.agent.selected_tools,
                  refusal_rules: bundle.agent.refusal_rules,
                  output_contract: bundle.agent.output_contract,
                  source_citation_requirements: bundle.agent.source_citation_requirements,
                  known_limitations: bundle.agent.known_limitations,
                },
                requirements: bundle.requirements,
                groundability: bundle.groundability,
              };
              const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${bundle.agent.id}_definition_and_config.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Agent Config JSON
          </button>
          <a
            href={`/api/agents/${encodeURIComponent(r.agent_id)}/export/scorecard.csv`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Scorecard CSV
          </a>
          <a
            href={`/api/agents/${encodeURIComponent(r.agent_id)}/export/quality_report.json`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-xs font-medium text-white whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Full Report JSON
          </a>
        </div>
      </div>

      {/* Top Honest Scorecard KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-[#0B1120] text-white rounded-xl p-5 border border-slate-800">
          <div className="text-xs text-slate-300">Overall Pass Rate</div>
          <div className="mt-1.5 text-3xl font-semibold tabular-nums">{r.overall_score}%</div>
          <div className="mt-1 text-xs text-slate-400 tabular-nums">
            {r.correct_answers + r.correct_refusals} / {r.total_cases} passed
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Answerable Accuracy</div>
          <div className="mt-1.5 text-2xl font-semibold text-slate-900 tabular-nums">
            {r.correct_answers} / {r.correct_answers + r.incorrect_answers}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {r.incorrect_answers} incorrect answers
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Refusal Accuracy</div>
          <div className="mt-1.5 text-2xl font-semibold text-slate-900 tabular-nums">
            {r.correct_refusals} / {r.correct_refusals + r.incorrect_refusals}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {r.incorrect_refusals} missed refusals
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Grounding & Citations</div>
          <div className="mt-1.5 text-2xl font-semibold text-slate-900 tabular-nums">
            {r.grounding_score}%
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Citation accuracy: {r.citation_accuracy}%
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Budget Telemetry</div>
          <div className="mt-1.5 text-2xl font-semibold text-slate-900 tabular-nums">
            {r.budget_metrics.total_llm_calls} calls
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            ~{r.budget_metrics.estimated_tokens.toLocaleString()} tokens
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Before-and-After Optimization Progression
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verified overall evaluation pass rate across Critic-Optimizer iterations.
            </p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="stage" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="score" fill="#0f172a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Sub-Metric Quality Breakdown
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mean hybrid judge scores across all {r.total_cases} test cases.
            </p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dimensionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis type="category" dataKey="metric" width={92} tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="pct" fill="#0284c7" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Pipeline Integrity ("Distrust Your Pipeline") Deterministic Audit */}
      {integrity && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-800" />
                Pipeline Integrity Self-Audit (Deterministic Anti-Lying Checks)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Independent deterministic verification scanning agent outputs for fabricated ghost citations, ungrounded numbers, and unnecessary tools.
              </p>
            </div>
            <span
              className={`text-xs font-semibold ${
                integrity.tool_hygiene_passed ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {integrity.tool_hygiene_passed ? 'Tool Hygiene Passed' : 'Tool Hygiene Flagged'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="border-b sm:border-b-0 sm:border-r border-slate-100 pb-2 sm:pb-0 sm:pr-4">
              <div className="text-slate-500">Ghost Citations Caught</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                {integrity.ghost_citations_caught}
              </div>
              <div className="text-[11px] text-slate-500">
                Citations not found in retrieved chunks
              </div>
            </div>
            <div className="border-b sm:border-b-0 sm:border-r border-slate-100 pb-2 sm:pb-0 sm:pr-4">
              <div className="text-slate-500">Ungrounded Numbers Flagged</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                {integrity.ungrounded_numbers_caught}
              </div>
              <div className="text-[11px] text-slate-500">
                Numeric tokens absent from evidence/tools
              </div>
            </div>
            <div>
              <div className="text-slate-500">Tool Attachment Audit</div>
              <div className="mt-1 text-xs font-medium text-slate-900">
                {integrity.tool_hygiene_note}
              </div>
            </div>
          </div>

          {integrity.flagged_details.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
              <div className="font-semibold text-slate-800">Deterministic Audit Findings:</div>
              {integrity.flagged_details.map((d, i) => (
                <div key={i} className="text-slate-600 font-mono text-[11px]">
                  • [{d.test_id}] ({d.issue_type}): {d.detail}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Factory vs. Human Baseline Head-to-Head */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Factory vs. Hand-Written Human Baseline
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare ForgeAI’s generated & optimized agent against a hand-written human baseline prompt on the exact same {r.total_cases} cases.
            </p>
          </div>
          <button
            onClick={handleRunBaselineComparison}
            disabled={comparing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            {comparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {comparing ? 'Evaluating Human Baseline...' : 'Run Live Head-to-Head'}
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-700">
            Hand-Written Human Baseline System Prompt (Editable)
          </label>
          <textarea
            rows={3}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800"
          />
          {compareError && <p className="text-xs text-red-600">{compareError}</p>}
        </div>

        {baseline ? (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-500">ForgeAI Factory</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                  {baseline.factory_score}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">Human Baseline</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                  {baseline.human_score}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">Factory Head-to-Head Wins</div>
                <div className="mt-1 text-xl font-semibold text-emerald-700 tabular-nums">
                  {baseline.factory_wins.length}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Human Baseline Wins / Ties</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                  {baseline.human_wins.length} wins · {baseline.ties} ties
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-700">{baseline.summary}</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <div className="font-semibold text-emerald-800">
                  Where ForgeAI Beat Human Baseline ({baseline.factory_wins.length})
                </div>
                {baseline.factory_wins.length === 0 ? (
                  <p className="text-slate-500">No head-to-head factory wins recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {baseline.factory_wins.map((w) => (
                      <div key={w.test_id} className="rounded-lg border border-slate-200 p-3 space-y-1">
                        <div className="font-mono font-semibold text-slate-900">
                          {w.test_id} · Factory {Math.round(w.factory_score * 100)}% vs Human{' '}
                          {Math.round(w.human_score * 100)}%
                        </div>
                        <div className="text-slate-700">{w.question}</div>
                        <div className="text-slate-500">{w.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-amber-800">
                  Where Human Baseline Beat ForgeAI ({baseline.human_wins.length})
                </div>
                {baseline.human_wins.length === 0 ? (
                  <p className="text-slate-500">Human baseline had zero wins over ForgeAI.</p>
                ) : (
                  <div className="space-y-2">
                    {baseline.human_wins.map((w) => (
                      <div key={w.test_id} className="rounded-lg border border-slate-200 p-3 space-y-1">
                        <div className="font-mono font-semibold text-slate-900">
                          {w.test_id} · Human {Math.round(w.human_score * 100)}% vs Factory{' '}
                          {Math.round(w.factory_score * 100)}%
                        </div>
                        <div className="text-slate-700">{w.question}</div>
                        <div className="text-slate-500">{w.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Click &ldquo;Run Live Head-to-Head&rdquo; to benchmark your hand-written baseline prompt against ForgeAI on this workspace.
          </p>
        )}
      </div>

      {/* Honest Remaining Failures */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Remaining Failures & Root Causes ({r.remaining_failures.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ForgeAI reports every unresolved failure honestly rather than inflating scores.
          </p>
        </div>
        {r.remaining_failures.length === 0 ? (
          <div className="text-xs text-emerald-700">
            Zero remaining failures on the current evaluation suite.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {r.remaining_failures.map((f) => (
              <div key={f.test_id} className="py-3.5 space-y-1 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">
                    {f.test_id} · {f.category}
                  </span>
                  <span className="font-semibold text-red-700">{f.failure_category}</span>
                </div>
                <div className="text-slate-800 font-medium">{f.question}</div>
                <div className="text-slate-600">{f.failure_explanation}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Known Limitations & Recommended Improvements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Known Document & Agent Limitations</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700">
            {r.known_limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Recommended Next Improvements</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700">
            {r.recommended_improvements.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
