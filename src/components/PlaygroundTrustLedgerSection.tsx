import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Send, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { sendPlaygroundMessage } from '../lib/api';
import type { AgentWorkspaceBundle, TrustLedgerEntry, TrustStatus } from '../types/forge';

interface PlaygroundTrustLedgerSectionProps {
  bundle: AgentWorkspaceBundle | null;
  onTrustLedgerAppended: (agentId: string, entry: TrustLedgerEntry) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  ledgerEntry?: TrustLedgerEntry;
}

function TrustBadge({ status }: { status: TrustStatus }) {
  if (status === 'GREEN') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5" />
        GREEN · Supported by Evidence
      </span>
    );
  }
  if (status === 'YELLOW') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
        <AlertCircle className="w-3.5 h-3.5" />
        YELLOW · Partially Supported / Uncertain
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
      <ShieldAlert className="w-3.5 h-3.5" />
      RED · Unsupported / Refusal Required
    </span>
  );
}

export function PlaygroundTrustLedgerSection({
  bundle,
  onTrustLedgerAppended,
}: PlaygroundTrustLedgerSectionProps) {
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);

  if (!bundle) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        Select an agent to chat in the Generic Agent Runner and inspect the Trust Ledger.
      </div>
    );
  }

  const agentId = bundle.agent.id;
  const messages = messagesByAgent[agentId] ?? [];
  const activeLedger =
    bundle.trust_ledger.find((t) => t.id === selectedLedgerId) ?? bundle.trust_ledger[0] ?? null;

  const samplePrompts = [
    bundle.eval_cases.find((c) => c.category === 'answerable')?.question,
    bundle.eval_cases.find((c) => c.category === 'out_of_scope')?.question,
    bundle.eval_cases.find((c) => c.category === 'edge_case')?.question,
  ].filter(Boolean) as string[];

  async function handleSend(textToSend?: string) {
    const q = (textToSend ?? input).trim();
    if (!q || sending || !bundle) return;
    setError(null);
    setSending(true);
    if (!textToSend) setInput('');

    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    const optimistic: ChatMessage[] = [...messages, { role: 'user', text: q }];
    setMessagesByAgent((prev) => ({ ...prev, [agentId]: optimistic }));

    try {
      const res = await sendPlaygroundMessage({
        agent_id: agentId,
        question: q,
        history,
      });
      setMessagesByAgent((prev) => ({
        ...prev,
        [agentId]: [
          ...optimistic,
          { role: 'assistant', text: res.answer, ledgerEntry: res.trust_ledger },
        ],
      }));
      setSelectedLedgerId(res.trust_ledger.id);
      onTrustLedgerAppended(agentId, res.trust_ledger);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Agent runner failed.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Live Agent Playground & Trust Ledger</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Generic runner executing <span className="font-medium text-slate-800">{bundle.agent.agent_name}</span> · Tools:{' '}
            <span className="font-mono text-xs">
              {bundle.agent.selected_tools.length > 0 ? bundle.agent.selected_tools.join(', ') : 'none'}
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Generic Chat Runner (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl flex flex-col h-[660px]">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-medium text-slate-700">
              Generic Runtime · Top-K={bundle.agent.retrieval_config.top_k} · Threshold=
              {bundle.agent.retrieval_config.similarity_threshold}
            </div>
            <button
              onClick={() => setMessagesByAgent((p) => ({ ...p, [agentId]: [] }))}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Clear Thread
            </button>
          </div>

          {/* Suggested Test Probes */}
          {samplePrompts.length > 0 && messages.length === 0 && (
            <div className="p-5 border-b border-slate-100 bg-slate-50/60 space-y-2">
              <p className="text-xs font-medium text-slate-600">
                Quick Test Probes (Answerable · Out-of-Scope Refusal · Edge Case):
              </p>
              <div className="flex flex-col gap-1.5">
                {samplePrompts.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(q)}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-slate-400 text-slate-700 transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="text-xs text-slate-500 pt-4">
                Ask any domain question or attempt an out-of-scope question. Every response is audited live by the Trust Ledger on the right.
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[#0B1120] text-white'
                      : 'bg-slate-100 text-slate-900 border border-slate-200'
                  }`}
                >
                  {msg.text}
                </div>
                {msg.ledgerEntry && (
                  <button
                    onClick={() => setSelectedLedgerId(msg.ledgerEntry!.id)}
                    className="mt-1.5 flex items-center gap-2 text-[11px] hover:underline cursor-pointer"
                  >
                    <TrustBadge status={msg.ledgerEntry.grounding_status} />
                    <span className="text-slate-400 font-mono tabular-nums">
                      · {msg.ledgerEntry.latency_ms}ms · Inspect Ledger
                    </span>
                  </button>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Retrieving chunks, executing attached tools, and auditing claims...
              </div>
            )}
          </div>

          {error && (
            <div className="px-5 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-4 border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask ${bundle.agent.agent_name}...`}
              className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </div>

        {/* Right: Trust Ledger Verifier (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl flex flex-col h-[660px]">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-slate-800" />
              <h2 className="text-sm font-semibold text-slate-900">Trust Ledger Audit</h2>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {bundle.trust_ledger.length} entries
            </span>
          </div>

          {/* Ledger Entry Selector */}
          {bundle.trust_ledger.length > 0 && (
            <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50 overflow-x-auto flex gap-2">
              {bundle.trust_ledger.slice(0, 8).map((entry) => {
                const active = activeLedger?.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedLedgerId(entry.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer border ${
                      active
                        ? 'bg-[#0B1120] text-white border-[#0B1120]'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {entry.grounding_status} · {entry.question.slice(0, 22)}...
                  </button>
                );
              })}
            </div>
          )}

          {activeLedger ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TrustBadge status={activeLedger.grounding_status} />
                <span className="font-mono text-slate-500 tabular-nums">
                  {typeof activeLedger.confidence_score === 'number'
                    ? `Conf: ${activeLedger.confidence_score}% · `
                    : ''}
                  Rel: {activeLedger.evidence_relevance} · {activeLedger.latency_ms}ms
                </span>
              </div>
              {activeLedger.calibration_reason && (
                <div className="text-[11px] text-slate-500 font-mono">
                  Calibration: {activeLedger.calibration_reason}
                </div>
              )}

              <div className="space-y-1">
                <div className="font-semibold text-slate-700">User Question</div>
                <div className="text-slate-900">{activeLedger.question}</div>
              </div>

              <div className="space-y-1">
                <div className="font-semibold text-slate-700">Generated Answer</div>
                <div className="text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {activeLedger.answer}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <div>
                  <div className="font-semibold text-slate-700">Supporting Documents</div>
                  <div className="text-slate-600 font-mono text-[11px] mt-0.5">
                    {activeLedger.supporting_documents.length > 0
                      ? activeLedger.supporting_documents.join(', ')
                      : 'None'}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-slate-700">Page / Row Locations</div>
                  <div className="text-slate-600 font-mono text-[11px] mt-0.5">
                    {activeLedger.supporting_locations.length > 0
                      ? activeLedger.supporting_locations.join(', ')
                      : 'None'}
                  </div>
                </div>
              </div>

              {activeLedger.deterministic_checks && (
                <div className="border-t border-slate-100 pt-3 grid grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <span className="font-semibold text-slate-700">Ghost Citations: </span>
                    <span
                      className={
                        activeLedger.deterministic_checks.ghost_citations.length === 0
                          ? 'text-emerald-700 font-medium'
                          : 'text-red-700 font-medium'
                      }
                    >
                      {activeLedger.deterministic_checks.ghost_citations.length === 0
                        ? '0 caught'
                        : `${activeLedger.deterministic_checks.ghost_citations.length} flagged`}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">Numeric Grounding: </span>
                    <span
                      className={
                        activeLedger.deterministic_checks.ungrounded_numbers.length === 0
                          ? 'text-emerald-700 font-medium'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      {activeLedger.deterministic_checks.ungrounded_numbers.length === 0
                        ? 'Verified'
                        : `${activeLedger.deterministic_checks.ungrounded_numbers.length} unverified`}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">Contradictions: </span>
                    <span
                      className={
                        (activeLedger.deterministic_checks.contradictions?.length ?? 0) === 0
                          ? 'text-emerald-700 font-medium'
                          : 'text-red-700 font-medium'
                      }
                    >
                      {(activeLedger.deterministic_checks.contradictions?.length ?? 0) === 0
                        ? '0 caught'
                        : `${activeLedger.deterministic_checks.contradictions?.length} flagged`}
                    </span>
                  </div>
                </div>
              )}

              {activeLedger.unsupported_claims.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 space-y-1">
                  <div className="font-semibold">Unsupported Claims Flagged:</div>
                  {activeLedger.unsupported_claims.map((c, i) => (
                    <div key={i}>• {c}</div>
                  ))}
                </div>
              )}

              {activeLedger.tool_executions.length > 0 && (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    Tool Executions ({activeLedger.tool_executions.length})
                  </div>
                  {activeLedger.tool_executions.map((t, idx) => (
                    <div key={idx} className="rounded bg-slate-50 border border-slate-200 p-2.5 font-mono text-[11px]">
                      <div className="font-semibold text-slate-900">
                        {t.tool}({JSON.stringify(t.arguments)})
                      </div>
                      <div className="text-slate-600 mt-1">{t.result_summary}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="font-semibold text-slate-700">
                  Retrieved Evidence ({activeLedger.retrieved_evidence.length})
                </div>
                {activeLedger.retrieved_evidence.length === 0 ? (
                  <div className="text-slate-500">No chunks passed similarity threshold.</div>
                ) : (
                  activeLedger.retrieved_evidence.map((ev) => (
                    <div
                      key={ev.chunk_id}
                      className="rounded border border-slate-200 bg-slate-50 p-2.5 space-y-1"
                    >
                      <div className="font-mono text-[11px] font-semibold text-slate-800">
                        {ev.document_name} · {ev.page_or_row} · sim {ev.similarity_score}
                      </div>
                      <div className="text-[11px] text-slate-600 leading-relaxed">
                        {ev.source_text.slice(0, 260)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 text-xs text-slate-500">
              Send a message to generate a live Trust Ledger audit entry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
