import type { AgentWorkspaceBundle } from '../types/forge';

interface OptimizationHistorySectionProps {
  bundle: AgentWorkspaceBundle | null;
}

export function OptimizationHistorySection({ bundle }: OptimizationHistorySectionProps) {
  if (!bundle) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        Select an agent to inspect its optimization iterations.
      </div>
    );
  }

  const logs = bundle.optimization_logs;
  const tournament = bundle.quality_report?.prompt_tournament ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Optimization History</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Surgical Critic-Optimizer iterations (max 3) for{' '}
          <span className="font-medium text-slate-800">{bundle.agent.agent_name}</span>. Every parameter or prompt diff is logged with before/after score verification.
        </p>
      </div>

      {tournament.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Prompt Tournament Benchmark (Pre-Optimization Selection)
            </h2>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Candidate</th>
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 font-medium text-right">Sample Score</th>
                <th className="px-4 py-3 font-medium text-right">Grounding</th>
                <th className="px-4 py-3 font-medium text-right">Refusal Acc.</th>
                <th className="px-6 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tournament.map((cand) => (
                <tr key={cand.candidate_id} className={cand.selected ? 'bg-sky-50/50' : ''}>
                  <td className="px-6 py-3 font-medium text-slate-900">{cand.label}</td>
                  <td className="px-4 py-3 text-slate-600">{cand.strategy}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{cand.sample_score}%</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{cand.grounding_score}%</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{cand.refusal_accuracy}%</td>
                  <td className="px-6 py-3 font-semibold">
                    {cand.selected ? (
                      <span className="text-emerald-700">Selected Winner</span>
                    ) : (
                      <span className="text-slate-400">Eliminated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
          No optimization iterations logged yet for this agent.
        </div>
      ) : (
        <div className="space-y-4">
          {logs.map((iter) => {
            const delta = Number((iter.new_score - iter.previous_score).toFixed(1));
            return (
              <div key={iter.iteration} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Iteration {iter.iteration} of 3
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">{iter.notes}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                    <span className="text-slate-500">Before: {iter.previous_score}%</span>
                    <span className="font-semibold text-slate-900">After: {iter.new_score}%</span>
                    <span className={delta >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                      ({delta >= 0 ? `+${delta}%` : `${delta}%`})
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 text-xs text-slate-600">
                  <div>
                    Failures Identified:{' '}
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {iter.failures_identified}
                    </span>
                  </div>
                  <div>
                    Resolved in Re-Eval:{' '}
                    <span className="font-semibold text-emerald-700 tabular-nums">
                      {iter.resolved_count}
                    </span>
                  </div>
                  <div>
                    Failure Breakdown:{' '}
                    <span className="font-mono">
                      {Object.entries(iter.failure_breakdown)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', ') || 'None'}
                    </span>
                  </div>
                </div>

                {iter.exact_changes.length > 0 && (
                  <div className="space-y-2.5 pt-2">
                    <p className="text-xs font-semibold text-slate-800">Targeted Changes Applied:</p>
                    {iter.exact_changes.map((chg, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {chg.target} · {chg.parameter_or_section}
                          </span>
                          <span className="text-slate-500 font-mono">
                            Target failure: {chg.failure_category}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 font-mono text-[11px]">
                          <div className="text-slate-500">
                            <span className="font-semibold text-slate-700">Previous:</span> {chg.previous_value}
                          </div>
                          <div className="text-slate-900">
                            <span className="font-semibold text-emerald-700">New:</span> {chg.new_value}
                          </div>
                        </div>
                        <div className="text-slate-600 pt-0.5">Reason: {chg.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
