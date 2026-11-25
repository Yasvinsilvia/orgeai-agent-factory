import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2, Play } from 'lucide-react';
import { reEvaluateAgent } from '../lib/api';
import type { AgentWorkspaceBundle, EvalCaseResult } from '../types/forge';

interface EvaluationLabSectionProps {
  bundle: AgentWorkspaceBundle | null;
  onBundleUpdated: (bundle: AgentWorkspaceBundle) => void;
}

export function EvaluationLabSection({ bundle, onBundleUpdated }: EvaluationLabSectionProps) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'answerable' | 'out_of_scope' | 'edge_case'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bundle) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        Select an agent to inspect its automated evaluation suite.
      </div>
    );
  }

  const filtered: EvalCaseResult[] = bundle.eval_results.filter((r) => {
    if (filter === 'passed') return r.passed;
    if (filter === 'failed') return !r.passed;
    if (filter === 'answerable' || filter === 'out_of_scope' || filter === 'edge_case') {
      return r.category === filter;
    }
    return true;
  });

  async function handleReRun() {
    if (!bundle) return;
    setRunning(true);
    setError(null);
    try {
      const updated = await reEvaluateAgent(bundle.agent.id, 2);
      onBundleUpdated(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Live evaluation failed.');
    } finally {
      setRunning(false);
    }
  }

  const passedCount = bundle.eval_results.filter((r) => r.passed).length;
  const totalCount = bundle.eval_results.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Evaluation Lab</h1>
          <p className="text-sm text-slate-500 mt-0.5 tabular-nums">
            {totalCount} auto-generated test cases · {passedCount} passed · {totalCount - passedCount} failed · Hybrid deterministic + LLM-as-Judge scoring
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href={`/api/agents/${encodeURIComponent(bundle.agent.id)}/export/eval_dataset.json`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Dataset JSON
          </a>
          <button
            onClick={handleReRun}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? 'Running Live Eval & Critic...' : 'Run Live Re-Evaluation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Interactive Filter Segmented Control */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            { key: 'all', label: `All (${totalCount})` },
            { key: 'passed', label: `Passed (${passedCount})` },
            { key: 'failed', label: `Failed (${totalCount - passedCount})` },
            { key: 'answerable', label: 'Answerable' },
            { key: 'out_of_scope', label: 'Out of Scope' },
            { key: 'edge_case', label: 'Edge Cases' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inspectable Evaluation Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-4 py-3 font-medium w-8"></th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-3 py-3 font-medium text-right">Ground</th>
                <th className="px-3 py-3 font-medium text-right">Correct</th>
                <th className="px-3 py-3 font-medium text-right">Refusal</th>
                <th className="px-3 py-3 font-medium text-right">Citation</th>
                <th className="px-4 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => {
                const isExpanded = expandedId === row.test_id;
                return (
                  <>
                    <tr
                      key={row.test_id}
                      onClick={() => setExpandedId(isExpanded ? null : row.test_id)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-slate-800 whitespace-nowrap">
                        {row.test_id}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {row.category.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 text-slate-900 max-w-md truncate">{row.question}</td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {Math.round(row.scores.grounding * 100)}%
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {Math.round(row.scores.correctness * 100)}%
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {Math.round(row.scores.refusal_accuracy * 100)}%
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {Math.round(row.scores.citation_accuracy * 100)}%
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.passed ? (
                          <span className="font-semibold text-emerald-700">PASS</span>
                        ) : (
                          <span className="font-semibold text-red-700">
                            FAIL · {row.failure_category}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.test_id}-detail`} className="bg-slate-50/70">
                        <td colSpan={9} className="px-6 py-4 space-y-3 text-xs">
                          <div>
                            <span className="font-semibold text-slate-800">Full Question: </span>
                            <span className="text-slate-700">{row.question}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-800">Agent Response: </span>
                            <span className="text-slate-700">{row.agent_response}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                            <div>
                              <span className="font-semibold text-slate-800">Expected Facts: </span>
                              <span className="text-slate-600 font-mono">
                                {row.expected_facts.length > 0
                                  ? row.expected_facts.join(' | ')
                                  : row.expected_refusal
                                  ? 'Refusal required'
                                  : 'None'}
                              </span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Judge Diagnosis: </span>
                              <span className={row.passed ? 'text-emerald-700' : 'text-red-700'}>
                                {row.failure_explanation}
                              </span>
                            </div>
                          </div>
                          {row.retrieved_evidence.length > 0 && (
                            <div>
                              <span className="font-semibold text-slate-800">
                                Retrieved Evidence ({row.retrieved_evidence.length}):
                              </span>
                              <ul className="mt-1 space-y-1 text-slate-600 font-mono text-[11px]">
                                {row.retrieved_evidence.map((ev) => (
                                  <li key={ev.chunk_id}>
                                    [{ev.document_name}, {ev.page_or_row} · score {ev.similarity_score}] {ev.source_text.slice(0, 180)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
