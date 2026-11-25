import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  FileSearch,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  PlusCircle,
  Settings2,
} from 'lucide-react';
import { AgentConfigSection } from './components/AgentConfigSection';
import { CreateAgentSection } from './components/CreateAgentSection';
import { DocumentIntelligenceSection } from './components/DocumentIntelligenceSection';
import { EvaluationLabSection } from './components/EvaluationLabSection';
import { GeneratedAgentsSection } from './components/GeneratedAgentsSection';
import { OptimizationHistorySection } from './components/OptimizationHistorySection';
import { OverviewSection } from './components/OverviewSection';
import { PlaygroundTrustLedgerSection } from './components/PlaygroundTrustLedgerSection';
import { ReportsSection } from './components/ReportsSection';
import { deleteAgent, fetchDashboard, type ToolRegistryInfo } from './lib/api';
import type {
  AgentWorkspaceBundle,
  DashboardMetrics,
  TrustLedgerEntry,
} from './types/forge';

type SectionId =
  | 'overview'
  | 'create'
  | 'documents'
  | 'config'
  | 'evaluations'
  | 'optimization'
  | 'agents'
  | 'playground'
  | 'reports';

const NAV_ITEMS: Array<{ id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'create', label: 'Create Agent', icon: PlusCircle },
  { id: 'documents', label: 'Document Intelligence', icon: FileSearch },
  { id: 'config', label: 'Agent Configuration', icon: Settings2 },
  { id: 'evaluations', label: 'Evaluation Lab', icon: FlaskConical },
  { id: 'optimization', label: 'Optimization History', icon: GitBranch },
  { id: 'agents', label: 'Generated Agents', icon: Bot },
  { id: 'playground', label: 'Live Agent Playground', icon: MessageSquare },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

export default function App() {
  const [section, setSection] = useState<SectionId>('overview');
  const [agents, setAgents] = useState<AgentWorkspaceBundle[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    total_agents: 0,
    documents_processed: 0,
    total_chunks: 0,
    evaluation_cases_executed: 0,
    average_quality_score: 0,
    successful_evaluations: 0,
    failed_evaluations: 0,
    optimization_iterations: 0,
    active_agent_status: 'Loading...',
  });
  const [toolRegistry, setToolRegistry] = useState<ToolRegistryInfo[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>('demo_hr_policy_assistant');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshDashboard(preferredId?: string) {
    try {
      const targetId = preferredId ?? activeAgentId;
      const data = await fetchDashboard(targetId);
      setAgents(data.agents);
      setMetrics(data.metrics);
      setToolRegistry(data.tool_registry);
      if (data.agents.length > 0 && !data.agents.some((a) => a.agent.id === targetId)) {
        setActiveAgentId(data.agents[0].agent.id);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load ForgeAI workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshDashboard();
  }, []);

  const activeBundle = agents.find((a) => a.agent.id === activeAgentId) ?? agents[0] ?? null;

  function handleSelectAgent(id: string) {
    setActiveAgentId(id);
    refreshDashboard(id);
  }

  function handleFactoryComplete(bundle: AgentWorkspaceBundle) {
    setActiveAgentId(bundle.agent.id);
    refreshDashboard(bundle.agent.id);
    setSection('reports');
  }

  function handleBundleUpdated(updated: AgentWorkspaceBundle) {
    setAgents((prev) => prev.map((b) => (b.agent.id === updated.agent.id ? updated : b)));
    refreshDashboard(updated.agent.id);
  }

  function handleTrustLedgerAppended(agentId: string, entry: TrustLedgerEntry) {
    setAgents((prev) =>
      prev.map((b) =>
        b.agent.id === agentId ? { ...b, trust_ledger: [entry, ...b.trust_ledger] } : b
      )
    );
  }

  async function handleDeleteAgent(agentId: string) {
    await deleteAgent(agentId);
    await refreshDashboard();
  }

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === section)?.label ?? 'Overview';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Dark Navy Sidebar */}
      <aside className="w-64 bg-[#0B1120] text-slate-200 flex flex-col shrink-0 border-r border-slate-800">
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="text-lg font-bold tracking-tight text-white font-display">
            FORGEAI
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Autonomous Agent Factory</p>
        </div>

        {/* Active Agent Switcher */}
        <div className="px-4 py-3 border-b border-slate-800">
          <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
            Active Agent Workspace
          </label>
          <select
            value={activeBundle?.agent.id ?? ''}
            onChange={(e) => handleSelectAgent(e.target.value)}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 text-xs text-white px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {agents.map((b) => (
              <option key={b.agent.id} value={b.agent.id}>
                {b.agent.agent_name}
              </option>
            ))}
          </select>
        </div>

        {/* 9 Navigation Sections */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-3.5 border-t border-slate-800 text-[11px] text-slate-400">
          OceanAI GenAI Factory · Trust Ledger Enabled
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Top Header Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-8 flex items-center justify-between gap-8 shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
            <span className="font-medium text-slate-900">ForgeAI</span>
            <span aria-hidden="true">/</span>
            <span>{currentNavLabel}</span>
            {activeBundle && (
              <>
                <span aria-hidden="true">/</span>
                <span className="text-slate-700 truncate">{activeBundle.agent.agent_name}</span>
              </>
            )}
          </div>
          <button
            onClick={() => setSection('create')}
            className="px-4 py-1.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            New Agent Run
          </button>
        </header>

        {/* Workspace Viewport */}
        <main className="flex-1 p-8 max-w-[1360px] w-full mx-auto">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
              {error}
            </div>
          )}

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-sm text-slate-500">
              Loading ForgeAI workspaces and evaluation reports...
            </div>
          ) : (
            <>
              {section === 'overview' && (
                <OverviewSection
                  metrics={metrics}
                  agents={agents}
                  activeAgentId={activeBundle?.agent.id ?? ''}
                  onSelectAgent={handleSelectAgent}
                  onNavigate={(s) => setSection(s as SectionId)}
                />
              )}
              {section === 'create' && (
                <CreateAgentSection onFactoryComplete={handleFactoryComplete} />
              )}
              {section === 'documents' && (
                <DocumentIntelligenceSection
                  bundle={activeBundle}
                  onBundleUpdated={handleBundleUpdated}
                />
              )}
              {section === 'config' && (
                <AgentConfigSection
                  bundle={activeBundle}
                  toolRegistry={toolRegistry}
                  onBundleUpdated={handleBundleUpdated}
                />
              )}
              {section === 'evaluations' && (
                <EvaluationLabSection
                  bundle={activeBundle}
                  onBundleUpdated={handleBundleUpdated}
                />
              )}
              {section === 'optimization' && (
                <OptimizationHistorySection bundle={activeBundle} />
              )}
              {section === 'agents' && (
                <GeneratedAgentsSection
                  agents={agents}
                  activeAgentId={activeBundle?.agent.id ?? ''}
                  onSelectAgent={handleSelectAgent}
                  onDeleteAgent={handleDeleteAgent}
                  onNavigate={(s) => setSection(s as SectionId)}
                />
              )}
              {section === 'playground' && (
                <PlaygroundTrustLedgerSection
                  bundle={activeBundle}
                  onTrustLedgerAppended={handleTrustLedgerAppended}
                />
              )}
              {section === 'reports' && (
                <ReportsSection bundle={activeBundle} onBundleUpdated={handleBundleUpdated} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
