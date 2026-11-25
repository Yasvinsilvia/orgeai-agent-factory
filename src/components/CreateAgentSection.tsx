import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, FolderOpen, Loader2, ShieldAlert } from 'lucide-react';
import {
  approveRequirements,
  finalizeRequirements,
  generateAndOptimizeAgent,
  uploadAndStartIntake,
} from '../lib/api';
import type {
  AgentWorkspaceBundle,
  ClarificationTurn,
  DocumentFile,
  GroundabilityReport,
  RequirementsSpec,
  ToolId,
} from '../types/forge';

interface CreateAgentSectionProps {
  onFactoryComplete: (bundle: AgentWorkspaceBundle) => void;
}

type FactoryStep = 'brief_upload' | 'clarification' | 'groundability_approval' | 'running' | 'done';

const ALL_TOOLS: { id: ToolId; label: string }[] = [
  { id: 'csv_lookup', label: 'CSV Lookup' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'public_weather', label: 'Public Weather (Open-Meteo)' },
  { id: 'current_date', label: 'Current Date' },
];

export function CreateAgentSection({ onFactoryComplete }: CreateAgentSectionProps) {
  const [step, setStep] = useState<FactoryStep>('brief_upload');
  const [brief, setBrief] = useState('');
  const [additionalReq, setAdditionalReq] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [agentId, setAgentId] = useState<string>('');
  const [processedDocs, setProcessedDocs] = useState<DocumentFile[]>([]);
  const [chunksCount, setChunksCount] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [preliminaryNotes, setPreliminaryNotes] = useState('');

  // Step 3 state (Requirements + Groundability + Human Approval)
  const [requirements, setRequirements] = useState<RequirementsSpec | null>(null);
  const [groundability, setGroundability] = useState<GroundabilityReport | null>(null);
  const [enableTournament, setEnableTournament] = useState(true);
  const [maxIterations, setMaxIterations] = useState(3);
  const [statusLog, setStatusLog] = useState<string[]>([]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setSelectedFiles(files);
      setError(null);
    }
  }

  async function handleStartIntake(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await uploadAndStartIntake({
        brief,
        additional_requirements: additionalReq,
        files: selectedFiles,
      });
      setAgentId(res.agent_id);
      setProcessedDocs(res.documents);
      setChunksCount(res.chunks_count);
      setQuestions(res.questions);
      setAnswers(res.questions.map(() => ''));
      setPreliminaryNotes(res.preliminary_notes);

      if (res.questions.length === 0) {
        // Brief is already unambiguous -> jump directly to requirements + groundability
        const fin = await finalizeRequirements({
          agent_id: res.agent_id,
          brief,
          additional_requirements: additionalReq,
          clarification_history: [],
        });
        setRequirements(fin.requirements);
        setGroundability(fin.groundability);
        setStep('groundability_approval');
      } else {
        setStep('clarification');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Intake failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFinalizeIntake(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const clarification_history: ClarificationTurn[] = questions.map((q, idx) => ({
        question: q,
        answer: answers[idx]?.trim() || 'No additional preference; follow uploaded documents strictly.',
      }));
      const fin = await finalizeRequirements({
        agent_id: agentId,
        brief,
        additional_requirements: additionalReq,
        clarification_history,
      });
      setRequirements(fin.requirements);
      setGroundability(fin.groundability);
      setStep('groundability_approval');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run Groundability Guard.');
    } finally {
      setLoading(false);
    }
  }

  function toggleTool(toolId: ToolId) {
    if (!requirements) return;
    const exists = requirements.required_tools.includes(toolId);
    const nextTools = exists
      ? requirements.required_tools.filter((t) => t !== toolId)
      : [...requirements.required_tools, toolId];
    setRequirements({ ...requirements, required_tools: nextTools });
  }

  async function handleApproveAndBuild() {
    if (!requirements) return;
    setError(null);
    setLoading(true);
    setStep('running');
    setStatusLog([
      'Saving human-approved RequirementsSpec and re-verifying Groundability Guard...',
      'Synthesizing declarative AgentDefinition & Prompt Tournament candidates...',
      'Auto-generating 22+ grounded evaluation test cases (answerable, out-of-scope, edge cases)...',
      'Executing Hybrid Judge + Critic-Optimizer loop (up to 3 surgical iterations)...',
    ]);

    try {
      await approveRequirements(agentId, requirements);
      const bundle = await generateAndOptimizeAgent({
        agent_id: agentId,
        enable_prompt_tournament: enableTournament,
        max_iterations: maxIterations,
      });
      setStep('done');
      onFactoryComplete(bundle);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Factory build pipeline failed.');
      setStep('groundability_approval');
    } finally {
      setLoading(false);
    }
  }

  function resetFactory() {
    setStep('brief_upload');
    setBrief('');
    setAdditionalReq('');
    setSelectedFiles([]);
    setQuestions([]);
    setAnswers([]);
    setRequirements(null);
    setGroundability(null);
    setError(null);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Create Autonomous Agent</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Provide an unseen brief and document folder. ForgeAI interviews, audits groundability, generates 22+ evals, and optimizes autonomously.
          </p>
        </div>
        {step !== 'brief_upload' && step !== 'running' && (
          <button
            onClick={resetFactory}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Start Over
          </button>
        )}
      </div>

      {/* Step Indicator */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        {[
          { key: 'brief_upload', label: '01. Brief & Documents' },
          { key: 'clarification', label: '02. Intake Interview' },
          { key: 'groundability_approval', label: '03. Groundability & Approval' },
          { key: 'running', label: '04. Build, Eval & Optimize' },
        ].map((item, idx) => {
          const order = ['brief_upload', 'clarification', 'groundability_approval', 'running', 'done'];
          const currentIdx = order.indexOf(step);
          const active = idx === currentIdx;
          const completed = idx < currentIdx;
          return (
            <div
              key={item.key}
              className={`px-3 py-2.5 rounded-lg border font-medium ${
                active
                  ? 'bg-[#0B1120] text-white border-[#0B1120]'
                  : completed
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              {item.label}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {step === 'brief_upload' && (
        <form onSubmit={handleStartIntake} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1.5">
              1. Assistant Brief (One Paragraph)
            </label>
            <textarea
              rows={4}
              required
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder='e.g., "I need an assistant for port logistics staff that answers vessel berthing SOPs, calculates demurrage fees from tariff CSVs, and refuses weather or customs duty questions if unsupported."'
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1.5">
              2. Optional Additional Constraints
            </label>
            <input
              type="text"
              value={additionalReq}
              onChange={(e) => setAdditionalReq(e.target.value)}
              placeholder="e.g., Formal compliance tone, always include [Document, Page/Row] citations"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1.5">
              3. Document Folder or Files (PDF, DOCX, TXT, CSV)
            </label>
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-3">
              <div className="flex justify-center">
                <FileUp className="w-7 h-7 text-slate-400" />
              </div>
              <p className="text-xs text-slate-600">
                Select multiple files or an entire folder. Empty, corrupted, duplicate, and unsupported formats are caught cleanly.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-medium cursor-pointer transition-colors">
                  <FileUp className="w-3.5 h-3.5" />
                  Select Files
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer transition-colors">
                  <FolderOpen className="w-3.5 h-3.5" />
                  Select Folder
                  <input
                    type="file"
                    webkitdirectory=""
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
              {selectedFiles.length > 0 && (
                <div className="pt-3 text-left max-w-xl mx-auto">
                  <p className="text-xs font-medium text-slate-700 mb-1.5">
                    Selected {selectedFiles.length} file(s):
                  </p>
                  <ul className="text-xs text-slate-600 space-y-1 max-h-32 overflow-y-auto">
                    {selectedFiles.map((f, idx) => (
                      <li key={idx} className="flex justify-between font-mono">
                        <span className="truncate">{f.name}</span>
                        <span className="text-slate-400 tabular-nums">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading || selectedFiles.length === 0 || brief.trim().length < 15}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Processing Documents & Running Intake...' : 'Run Intake Interviewer'}
            </button>
          </div>
        </form>
      )}

      {step === 'clarification' && (
        <form onSubmit={handleFinalizeIntake} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Intake Clarification Dialogue ({questions.length} of max 5 questions)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Indexed {processedDocs.filter((d) => d.status === 'processed').length} files into{' '}
                <span className="font-mono tabular-nums">{chunksCount}</span> chunks. {preliminaryNotes}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {questions.map((q, idx) => (
              <div key={idx} className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-800">
                  {idx + 1}. {q}
                </label>
                <input
                  type="text"
                  value={answers[idx] ?? ''}
                  onChange={(e) => {
                    const next = [...answers];
                    next[idx] = e.target.value;
                    setAnswers(next);
                  }}
                  placeholder="Enter your clarification (or leave blank to strictly follow documents)"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Running Groundability Guard...' : 'Synthesize Requirements & Audit Groundability'}
            </button>
          </div>
        </form>
      )}

      {step === 'groundability_approval' && requirements && groundability && (
        <div className="space-y-6">
          {/* Groundability Guard Report */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-slate-700" />
                  Groundability Guard Pre-Build Audit
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Topics are verified against your uploaded chunks before agent generation to prevent hallucinations.
                </p>
              </div>
              <div className="text-sm font-semibold text-slate-900 tabular-nums">
                {groundability.overall_groundability_pct}% Document Coverage
              </div>
            </div>

            {groundability.flagged_gaps.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
                <p className="font-semibold">Flagged Unsupported Gaps (Refusal Enforced):</p>
                {groundability.flagged_gaps.map((gap, i) => (
                  <p key={i}>• {gap}</p>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Requested Topic</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 pl-4 font-medium">Document Evidence & Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groundability.checks.map((c, idx) => (
                    <tr key={idx}>
                      <td className="py-3 pr-4 font-medium text-slate-900 align-top">{c.topic}</td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            c.status === 'Fully supported'
                              ? 'text-emerald-700'
                              : c.status === 'Partially supported'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 pl-4 text-slate-600 align-top">
                        <div>{c.explanation}</div>
                        {c.source_documents.length > 0 && (
                          <div className="mt-1 font-mono text-[11px] text-slate-500">
                            Sources: {c.source_documents.join(', ')}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Human Approval Checkpoint */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                Human Approval Checkpoint (Editable Requirements)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Review and adjust the generated specification, tool bindings, and optimization budget before running the autonomous factory.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Agent Name</label>
                <input
                  type="text"
                  value={requirements.agent_name}
                  onChange={(e) => setRequirements({ ...requirements, agent_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Audience</label>
                <input
                  type="text"
                  value={requirements.target_audience}
                  onChange={(e) =>
                    setRequirements({ ...requirements, target_audience: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Scope</label>
                <textarea
                  rows={2}
                  value={requirements.scope}
                  onChange={(e) => setRequirements({ ...requirements, scope: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Must-Refuse Topics (one per line)
                </label>
                <textarea
                  rows={3}
                  value={requirements.must_refuse_topics.join('\n')}
                  onChange={(e) =>
                    setRequirements({
                      ...requirements,
                      must_refuse_topics: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Strict Tool Selection (attach ONLY needed tools)
                </label>
                <div className="space-y-2">
                  {ALL_TOOLS.map((tool) => {
                    const checked = requirements.required_tools.includes(tool.id);
                    return (
                      <label key={tool.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTool(tool.id)}
                          className="rounded border-slate-300"
                        />
                        <span>{tool.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableTournament}
                    onChange={(e) => setEnableTournament(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Run Prompt Tournament (3 candidates)</span>
                </label>
                <label className="flex items-center gap-2">
                  <span>Max Optimizer Iterations:</span>
                  <select
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(Number(e.target.value))}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3 (Max)</option>
                  </select>
                </label>
              </div>

              <button
                onClick={handleApproveAndBuild}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve & Run Autonomous Factory
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'running' && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
            <h2 className="text-base font-semibold text-slate-900">
              Autonomous Factory Pipeline Executing...
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Generating agent definition, benchmarking Prompt Tournament candidates, creating 22+ document-grounded test cases, judging responses, and running targeted optimization iterations. This typically takes 30–60 seconds.
          </p>
          <ul className="space-y-1.5 text-xs text-slate-600 font-mono pt-2">
            {statusLog.map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
