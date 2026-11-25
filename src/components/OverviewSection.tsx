import { ArrowRight, CheckCircle2, FileText, FlaskConical, ShieldCheck } from 'lucide-react';
import type { AgentWorkspaceBundle, DashboardMetrics } from '../types/forge';

interface OverviewSectionProps {
  metrics: DashboardMetrics;
  agents: AgentWorkspaceBundle[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  onNavigate: (section: string) => void;
}

export function OverviewSection({
  metrics,
  agents,
  activeAgentId,
  onSelectAgent,
  onNavigate,
}: OverviewSectionProps) {
  const activeBundle = agents.find((a) => a.agent.id === activeAgentId) ?? agents[0] ?? null;

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="rounded-xl bg-[#0B1120] text-white border border-slate-800 p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-medium text-sky-300 tracking-wide">
              Autonomous Agent Factory · Groundability Guard · Trust Ledger
            </p>
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-white">
              Build, audit, optimize, and verify grounded AI agents from any brief and document folder.
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Every agent produced by ForgeAI undergoes intake clarification, document groundability auditing, automatic 20+ case evaluation, up to 3 surgical optimization iterations, and live Trust Ledger claim verification.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => onNavigate('create')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Launch Factory Run
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate('playground')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-100 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Live Playground
            </button>
          </div>
        </div>
      </section>

      {/* Real Application Metrics Strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Agents Created</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_agents}
          </p>
          <p className="mt-1 text-xs text-slate-500 truncate">{metrics.active_agent_status}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Documents & Chunks</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.documents_processed}{' '}
            <span className="text-sm font-normal text-slate-500">
              / {metrics.total_chunks} chunks
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">PDF, DOCX, TXT, CSV indexed</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Evaluation Cases Executed</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.evaluation_cases_executed}
          </p>
          <p className="mt-1 text-xs text-slate-600 tabular-nums">
            {metrics.successful_evaluations} passed · {metrics.failed_evaluations} failed
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Average Quality Score</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.average_quality_score}%
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {metrics.optimization_iterations} optimization iterations logged
          </p>
        </div>
      </section>

      {/* Pipeline Stages + Active Agent Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Generated Agent Registry</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select any persisted agent to inspect its documents, evaluation lab, optimization diffs, and Trust Ledger.
              </p>
            </div>
            <button
              onClick={() => onNavigate('agents')}
              className="text-xs font-medium text-sky-700 hover:text-sky-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Manage All
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="px-6 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Docs</th>
                  <th className="px-4 py-3 font-medium">Tools</th>
                  <th className="px-4 py-3 font-medium text-right">Evals</th>
                  <th className="px-4 py-3 font-medium text-right">Honest Score</th>
                  <th className="px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((b) => {
                  const isSelected = b.agent.id === activeBundle?.agent.id;
                  const score = b.quality_report?.overall_score ?? 0;
                  return (
                    <tr
                      key={b.agent.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-sky-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-6 py-3.5">
                        <div className="font-medium text-slate-900">{b.agent.agent_name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {b.agent.is_demo ? 'Committed Demo' : 'Custom Factory Run'} · v{b.agent.version} · {b.agent.status}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 tabular-nums">
                        {b.documents.filter((d) => d.status === 'processed').length} files
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 font-mono">
                        {b.agent.selected_tools.length > 0
                          ? b.agent.selected_tools.join(', ')
                          : 'none'}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-700 tabular-nums">
                        {b.eval_results.length}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">
                        {score}%
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <button
                          onClick={() => onSelectAgent(b.agent.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isSelected
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-300 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {isSelected ? 'Active' : 'Inspect'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active Agent Snapshot */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          {activeBundle ? (
            <>
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-500">Active Workspace Snapshot</div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {activeBundle.agent.agent_name}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {activeBundle.agent.description}
                </p>

                <div className="pt-3 border-t border-slate-100 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                      Groundability Coverage
                    </span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {activeBundle.groundability.overall_groundability_pct}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <FlaskConical className="w-3.5 h-3.5 text-slate-400" />
                      Eval Pass Rate
                    </span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {activeBundle.quality_report?.overall_score ?? 0}% (
                      {activeBundle.eval_results.filter((r) => r.passed).length}/
                      {activeBundle.eval_results.length})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      Trust Ledger Entries
                    </span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {activeBundle.trust_ledger.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
                      Optimization Iterations
                    </span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {activeBundle.optimization_logs.length} / 3 max
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
                <button
                  onClick={() => onNavigate('reports')}
                  className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-700 text-center transition-colors cursor-pointer"
                >
                  View Quality Report
                </button>
                <button
                  onClick={() => onNavigate('playground')}
                  className="px-3 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-xs font-medium text-white text-center transition-colors cursor-pointer"
                >
                  Test in Playground
                </button>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">No agent selected yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
