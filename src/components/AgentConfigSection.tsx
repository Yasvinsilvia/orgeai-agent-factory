import { useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { rollbackAgentVersion, type ToolRegistryInfo } from '../lib/api';
import type { AgentWorkspaceBundle } from '../types/forge';

interface AgentConfigSectionProps {
  bundle: AgentWorkspaceBundle | null;
  toolRegistry: ToolRegistryInfo[];
  onBundleUpdated?: (bundle: AgentWorkspaceBundle) => void;
}

export function AgentConfigSection({
  bundle,
  toolRegistry,
  onBundleUpdated,
}: AgentConfigSectionProps) {
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  if (!bundle) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        Select an agent to inspect its declarative configuration.
      </div>
    );
  }

  const { agent, groundability, requirements } = bundle;
  const versions = bundle.versions ?? [];

  async function handleRollback(version: number) {
    if (!bundle || rollingBack !== null) return;
    setRollingBack(version);
    setRollbackError(null);
    try {
      const updated = await rollbackAgentVersion(bundle.agent.id, version);
      onBundleUpdated?.(updated);
    } catch (err: unknown) {
      setRollbackError(err instanceof Error ? err.message : 'Rollback failed.');
    } finally {
      setRollingBack(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Agent Configuration</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Declarative definition for <span className="font-medium text-slate-800">{agent.agent_name}</span> · Version{' '}
            <span className="font-mono tabular-nums">{agent.version}</span>
          </p>
        </div>
        <a
          href={`/api/agents/${encodeURIComponent(agent.id)}/export/agent_definition.json`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Export agent_definition.json
        </a>
      </div>

      {/* Retrieval Parameters & Tool Registry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Retrieval & Embedding Parameters</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="border-b border-slate-100 pb-2">
              <div className="text-slate-500">Chunk Size</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {agent.retrieval_config.chunk_size} chars
              </div>
            </div>
            <div className="border-b border-slate-100 pb-2">
              <div className="text-slate-500">Chunk Overlap</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {agent.retrieval_config.chunk_overlap} chars
              </div>
            </div>
            <div className="border-b border-slate-100 pb-2">
              <div className="text-slate-500">Top-K Retrieval</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {agent.retrieval_config.top_k} chunks
              </div>
            </div>
            <div className="border-b border-slate-100 pb-2">
              <div className="text-slate-500">Similarity Threshold</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {agent.retrieval_config.similarity_threshold}
              </div>
            </div>
          </div>

          <div className="pt-2 space-y-2 text-xs">
            <div>
              <span className="font-medium text-slate-700">Target Audience:</span>{' '}
              <span className="text-slate-600">{agent.target_audience}</span>
            </div>
            <div>
              <span className="font-medium text-slate-700">Tone:</span>{' '}
              <span className="text-slate-600">{agent.tone}</span>
            </div>
            <div>
              <span className="font-medium text-slate-700">Output Contract:</span>{' '}
              <span className="text-slate-600">{agent.output_contract}</span>
            </div>
            <div>
              <span className="font-medium text-slate-700">Citation Requirement:</span>{' '}
              <span className="text-slate-600">{agent.source_citation_requirements}</span>
            </div>
          </div>
        </div>

        {/* Strict Tool Selection Registry */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tool Registry Binding</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ForgeAI attaches only tools strictly required by the brief and uploaded data.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {toolRegistry.map((tool) => {
              const attached = agent.selected_tools.includes(tool.id as typeof agent.selected_tools[number]);
              return (
                <div key={tool.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                  <div>
                    <div className="font-medium text-slate-900">
                      {tool.name}{' '}
                      <span className="font-mono text-[11px] text-slate-500">({tool.id})</span>
                    </div>
                    <div className="text-slate-600 mt-0.5">{tool.description}</div>
                  </div>
                  <span
                    className={`font-semibold whitespace-nowrap shrink-0 ${
                      attached ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {attached ? 'Attached' : 'Excluded'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* System Prompt */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Generated System Prompt</h2>
        <pre className="bg-slate-950 text-slate-100 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">
          {agent.system_prompt}
        </pre>
      </div>

      {/* Refusal Rules, Groundability & Known Limitations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Refusal Boundaries & Known Limitations</h2>
          <div className="space-y-2 text-xs text-slate-700">
            <p className="font-medium text-slate-900">Refusal Rules:</p>
            <ul className="list-disc pl-5 space-y-1">
              {agent.refusal_rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p className="font-medium text-slate-900 pt-2">Known Limitations:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              {agent.known_limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Groundability Audit & Clarification Log</h2>
            <span className="text-xs font-semibold text-slate-900 tabular-nums">
              {groundability.overall_groundability_pct}% Supported
            </span>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {groundability.checks.map((c, i) => (
              <div key={i} className="py-2 flex items-start justify-between gap-3">
                <span className="text-slate-700">{c.topic}</span>
                <span
                  className={`font-semibold whitespace-nowrap shrink-0 ${
                    c.status === 'Fully supported'
                      ? 'text-emerald-700'
                      : c.status === 'Partially supported'
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
          {requirements.clarification_history.length > 0 && (
            <div className="pt-2 border-t border-slate-100 text-xs space-y-1.5">
              <p className="font-medium text-slate-900">Intake Clarifications:</p>
              {requirements.clarification_history.map((turn, idx) => (
                <div key={idx} className="text-slate-600">
                  <span className="font-medium text-slate-800">Q:</span> {turn.question}{' '}
                  <span className="font-medium text-slate-800">A:</span> {turn.answer}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Persisted Agent Versions & Rollback */}
      {versions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Agent Version History & Rollback</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Snapshots saved before and after Critic-Optimizer iterations. Restore any prior configuration version cleanly.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-600 tabular-nums">
              {versions.length} snapshot(s)
            </span>
          </div>
          {rollbackError && <p className="text-xs text-red-600">{rollbackError}</p>}
          <div className="divide-y divide-slate-100 text-xs">
            {versions.map((snap) => {
              const isCurrent = snap.version === agent.version;
              return (
                <div key={snap.version} className="py-3 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="font-medium text-slate-900 flex items-center gap-2">
                      <span className="font-mono">v{snap.version}</span>
                      {typeof snap.score === 'number' && (
                        <span className="text-slate-500 font-mono tabular-nums">
                          · {snap.score}% eval score
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-emerald-700 font-semibold">· Active</span>
                      )}
                    </div>
                    <div className="text-slate-600">{snap.reason}</div>
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleRollback(snap.version)}
                      disabled={rollingBack !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {rollingBack === snap.version ? 'Restoring...' : `Restore v${snap.version}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
