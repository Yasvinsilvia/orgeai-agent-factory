import { useEffect, useState } from 'react';
import { FileUp, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { fetchAgentChunks, runRegressionUpload, type ChunkPreview } from '../lib/api';
import type { AgentWorkspaceBundle, RegressionResult } from '../types/forge';

interface DocumentIntelligenceSectionProps {
  bundle: AgentWorkspaceBundle | null;
  onBundleUpdated: (bundle: AgentWorkspaceBundle) => void;
}

export function DocumentIntelligenceSection({
  bundle,
  onBundleUpdated,
}: DocumentIntelligenceSectionProps) {
  const [chunks, setChunks] = useState<ChunkPreview[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocFilter, setSelectedDocFilter] = useState('all');

  // Regression Mode state
  const [regFiles, setRegFiles] = useState<File[]>([]);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [latestRegression, setLatestRegression] = useState<RegressionResult | null>(
    bundle?.regression_result ?? null
  );

  useEffect(() => {
    setLatestRegression(bundle?.regression_result ?? null);
    if (!bundle) {
      setChunks([]);
      return;
    }
    setLoadingChunks(true);
    fetchAgentChunks(bundle.agent.id)
      .then((data) => setChunks(data))
      .catch(() => setChunks([]))
      .finally(() => setLoadingChunks(false));
  }, [bundle?.agent.id]);

  if (!bundle) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        Select an agent to inspect its processed documents and vector chunks.
      </div>
    );
  }

  const docNames = Array.from(new Set(chunks.map((c) => c.document_name)));
  const normalizedDocQuery = docSearchQuery.trim().toLowerCase();

  const filteredDocuments = bundle.documents.filter((doc) => {
    if (!normalizedDocQuery) return true;
    if (
      doc.filename.toLowerCase().includes(normalizedDocQuery) ||
      doc.file_type.toLowerCase().includes(normalizedDocQuery) ||
      doc.preview_text.toLowerCase().includes(normalizedDocQuery)
    ) {
      return true;
    }
    return chunks.some(
      (c) =>
        c.document_name === doc.filename &&
        c.source_text.toLowerCase().includes(normalizedDocQuery)
    );
  });

  const filteredChunks = chunks.filter((c) => {
    if (selectedDocFilter !== 'all' && c.document_name !== selectedDocFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.source_text.toLowerCase().includes(q) ||
        c.document_name.toLowerCase().includes(q) ||
        c.page_or_row.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleRunRegression(e: React.FormEvent) {
    e.preventDefault();
    if (!bundle || regFiles.length === 0) return;
    setRegLoading(true);
    setRegError(null);
    try {
      const res = await runRegressionUpload(bundle.agent.id, regFiles);
      setLatestRegression(res.regression);
      onBundleUpdated(res.bundle);
      const updatedChunks = await fetchAgentChunks(bundle.agent.id);
      setChunks(updatedChunks);
      setRegFiles([]);
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'Regression run failed.');
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Document Intelligence</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Processed sources, chunk provenance ({chunks.length} chunks), and document-update regression testing for{' '}
          <span className="font-medium text-slate-800">{bundle.agent.agent_name}</span>.
        </p>
      </div>

      {/* Processed Files Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Ingested Source Files{' '}
              <span className="font-normal text-slate-500 tabular-nums">
                ({filteredDocuments.length} of {bundle.documents.length})
              </span>
            </h2>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={docSearchQuery}
              onChange={(e) => setDocSearchQuery(e.target.value)}
              placeholder="Filter documents by filename or content..."
              aria-label="Filter processed documents by filename or content"
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            {docSearchQuery && (
              <button
                type="button"
                onClick={() => setDocSearchQuery('')}
                aria-label="Clear document search"
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Filename</th>
                <th className="px-4 py-3 font-medium">Format</th>
                <th className="px-4 py-3 font-medium text-right">Segments</th>
                <th className="px-4 py-3 font-medium text-right">Chunks</th>
                <th className="px-4 py-3 font-medium text-right">Size</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-xs text-slate-500">
                    No processed documents match &ldquo;{docSearchQuery}&rdquo;.{' '}
                    <button
                      type="button"
                      onClick={() => setDocSearchQuery('')}
                      className="text-sky-700 hover:underline font-medium ml-1 cursor-pointer"
                    >
                      Clear search
                    </button>
                  </td>
                </tr>
              ) : (
                filteredDocuments.map((doc) => {
                  const matchingChunk = normalizedDocQuery
                    ? chunks.find(
                        (c) =>
                          c.document_name === doc.filename &&
                          c.source_text.toLowerCase().includes(normalizedDocQuery)
                      )
                    : undefined;
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 font-medium text-slate-900">
                        <div>
                          {doc.filename}
                          {doc.is_demo && (
                            <span className="ml-2 text-[11px] font-normal text-slate-500">
                              · Demo Sample Data
                            </span>
                          )}
                        </div>
                        {matchingChunk && (
                          <div className="mt-1 text-[11px] font-normal text-slate-500 line-clamp-1 font-mono">
                            Match ({matchingChunk.page_or_row}): {matchingChunk.source_text.slice(0, 140)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 uppercase">{doc.file_type}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {doc.page_or_row_count}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {doc.chunk_count}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {(doc.size_bytes / 1024).toFixed(1)} KB
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`font-medium ${
                            doc.status === 'processed'
                              ? 'text-emerald-700'
                              : doc.status === 'duplicate_skipped'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {doc.status}
                        </span>
                        {doc.error_message && (
                          <div className="text-[11px] text-red-600 mt-0.5">{doc.error_message}</div>
                        )}
                        {doc.prompt_injection_flags && doc.prompt_injection_flags.length > 0 && (
                          <div className="text-[11px] text-amber-700 mt-0.5 font-mono">
                            Sanitized {doc.prompt_injection_flags.length} injection directive(s)
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Regression Testing Mode (Upload updated docs -> re-run eval suite) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Document Regression Testing Mode
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload updated or supplemental documents to re-index this agent and re-run its {bundle.eval_cases.length}-case evaluation suite to detect regressions.
            </p>
          </div>
        </div>

        <form onSubmit={handleRunRegression} className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer">
            <FileUp className="w-3.5 h-3.5" />
            {regFiles.length > 0 ? `${regFiles.length} file(s) staged` : 'Choose Updated Docs'}
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv"
              onChange={(e) => setRegFiles(Array.from(e.target.files ?? []))}
              className="hidden"
            />
          </label>
          <button
            type="submit"
            disabled={regLoading || regFiles.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
          >
            {regLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {regLoading ? 'Re-indexing & Checking Regressions...' : 'Run Regression Suite'}
          </button>
        </form>

        {regError && <p className="text-xs text-red-600">{regError}</p>}

        {latestRegression && (
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex flex-wrap items-center gap-6 text-xs">
              <div>
                Previous Score:{' '}
                <span className="font-semibold tabular-nums">{latestRegression.previous_score}%</span>
              </div>
              <div>
                New Score:{' '}
                <span className="font-semibold tabular-nums">{latestRegression.new_score}%</span>
              </div>
              <div className="text-emerald-700 tabular-nums">
                Improvements: {latestRegression.improvements}
              </div>
              <div className="text-red-700 tabular-nums">
                Regressions Found: {latestRegression.regressions.length}
              </div>
            </div>
            {latestRegression.regressions.length > 0 && (
              <div className="space-y-2">
                {latestRegression.regressions.map((reg) => (
                  <div
                    key={reg.test_id}
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900"
                  >
                    <span className="font-mono font-semibold">{reg.test_id}</span> · {reg.question}
                    <div className="mt-1 text-red-700">Reason: {reg.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chunk Provenance Browser */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Indexed Chunk Provenance ({filteredChunks.length})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chunk text..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <select
              value={selectedDocFilter}
              onChange={(e) => setSelectedDocFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            >
              <option value="all">All Documents</option>
              {docNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loadingChunks ? (
          <div className="py-8 text-center text-xs text-slate-500">Loading indexed chunks...</div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {filteredChunks.slice(0, 40).map((chunk) => (
              <div key={chunk.chunk_id} className="py-3.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                  <span className="font-semibold text-slate-800">{chunk.document_name}</span>
                  <span>·</span>
                  <span>{chunk.page_or_row}</span>
                  <span>·</span>
                  <span>{chunk.chunk_id}</span>
                  <span>·</span>
                  <span className="tabular-nums">{chunk.char_count} chars</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {chunk.source_text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
