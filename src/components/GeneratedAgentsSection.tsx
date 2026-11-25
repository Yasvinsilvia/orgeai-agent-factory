import { Download, Trash2 } from 'lucide-react';
import type { AgentWorkspaceBundle } from '../types/forge';

interface GeneratedAgentsSectionProps {
  agents: AgentWorkspaceBundle[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  onDeleteAgent: (id: string) => void;
  onNavigate: (section: string) => void;
}

export function GeneratedAgentsSection({
  agents,
  activeAgentId,
  onSelectAgent,
  onDeleteAgent,
  onNavigate,
}: GeneratedAgentsSectionProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Generated Agents</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Persistent agent definitions, evaluation datasets, and quality scorecards stored on disk.
          </p>
        </div>
        <button
          onClick={() => onNavigate('create')}
          className="px-4 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
        >
          New Factory Run
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {agents.map((b) => {
          const isActive = b.agent.id === activeAgentId;
          const report = b.quality_report;
          return (
            <div
              key={b.agent.id}
              className={`bg-white rounded-xl p-6 border flex flex-col justify-between space-y-5 ${
                isActive ? 'border-sky-600' : 'border-slate-200'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">{b.agent.agent_name}</h2>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {b.agent.is_demo ? 'Committed Demo' : 'Custom Agent'} · v{b.agent.version} ·{' '}
                      {b.documents.filter((d) => d.status === 'processed').length} docs ·{' '}
                      {b.eval_cases.length} evals
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-lg font-semibold text-slate-900">
                      {report ? `${report.overall_score}%` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500">Honest Score</div>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">{b.agent.description}</p>

                <div className="text-xs text-slate-600 pt-1">
                  <span className="font-medium text-slate-800">Attached Tools:</span>{' '}
                  <span className="font-mono">
                    {b.agent.selected_tools.length > 0 ? b.agent.selected_tools.join(', ') : 'None'}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      onSelectAgent(b.agent.id);
                      onNavigate('playground');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                  >
                    Open Playground
                  </button>
                  <button
                    onClick={() => {
                      onSelectAgent(b.agent.id);
                      onNavigate('reports');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium cursor-pointer"
                  >
                    Report
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const exportPayload = {
                        exported_at: new Date().toISOString(),
                        agent_definition: b.agent,
                        configuration: {
                          retrieval_config: b.agent.retrieval_config,
                          selected_tools: b.agent.selected_tools,
                          refusal_rules: b.agent.refusal_rules,
                          output_contract: b.agent.output_contract,
                          source_citation_requirements: b.agent.source_citation_requirements,
                          known_limitations: b.agent.known_limitations,
                        },
                        requirements: b.requirements,
                        groundability: b.groundability,
                      };
                      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${b.agent.id}_definition_and_config.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export JSON
                  </button>
                  {!b.agent.is_demo && (
                    <button
                      onClick={() => onDeleteAgent(b.agent.id)}
                      title="Delete agent workspace"
                      className="p-1.5 rounded-md border border-slate-200 text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
