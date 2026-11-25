import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import type {
  ClarificationTurn,
  DocumentChunk,
  DocumentFile,
  RegressionResult,
  RequirementsSpec,
} from './src/types/forge.ts';
import { generateAgentDefinition } from './server/core/agentGenerator.ts';
import { runAgentTurn } from './server/core/agentRunner.ts';
import { runFactoryVsHumanBaseline } from './server/core/baselineComparator.ts';
import {
  buildQualityReport,
  computeOverallScore,
  runCriticOptimizerLoop,
  runPromptTournament,
} from './server/core/criticOptimizer.ts';
import { processUploadedFile } from './server/core/documentProcessor.ts';
import { generateEvaluationSuite } from './server/core/evalGenerator.ts';
import { BudgetTracker } from './server/core/gemini.ts';
import { runGroundabilityGuard } from './server/core/groundability.ts';
import { generateClarificationQuestions, synthesizeRequirementsSpec } from './server/core/intake.ts';
import { evaluateAgentOnSuite } from './server/core/judge.ts';
import { buildChunksFromSegments, ensureChunkEmbeddings, indexChunksWithEmbeddings } from './server/core/retrieval.ts';
import { seedInitialDemosIfMissing } from './server/core/seedDemos.ts';
import {
  appendTrustLedgerEntry,
  computeDashboardMetrics,
  deleteAgentWorkspace,
  ensureDataDirectories,
  listAllWorkspaceBundles,
  loadAgentDefinition,
  loadAgentVersions,
  loadChunks,
  loadCsvSourcesForAgent,
  loadDocumentsMetadata,
  loadEvalDataset,
  loadEvalResults,
  loadGroundability,
  loadQualityReport,
  loadRequirements,
  loadWorkspaceBundle,
  rollbackAgentToVersion,
  saveAgentDefinition,
  saveAgentVersionSnapshot,
  saveBaselineComparison,
  saveChunks,
  saveDocumentsMetadata,
  saveEvalDataset,
  saveEvalResults,
  saveGroundability,
  saveOptimizationLogs,
  saveQualityReport,
  saveRegressionResult,
  saveRequirements,
  saveUploadedRawFile,
} from './server/core/storage.ts';
import { TOOL_REGISTRY_META } from './server/core/tools.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 25 },
});

// In-memory staging store for intake sessions before final agent generation
const stagedSessions = new Map<
  string,
  {
    brief: string;
    additional_requirements?: string;
    documents: DocumentFile[];
    chunks: DocumentChunk[];
    tracker: BudgetTracker;
  }
>();

async function startServer() {
  ensureDataDirectories();
  await seedInitialDemosIfMissing();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      gemini_configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      tools: Object.values(TOOL_REGISTRY_META),
    });
  });

  app.get('/api/dashboard', (req, res) => {
    const selectedId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const bundles = listAllWorkspaceBundles();
    const metrics = computeDashboardMetrics(selectedId);
    res.json({
      metrics,
      agents: bundles,
      tool_registry: Object.values(TOOL_REGISTRY_META),
    });
  });

  app.get('/api/agents', (_req, res) => {
    res.json(listAllWorkspaceBundles());
  });

  app.get('/api/agents/:id', (req, res) => {
    const bundle = loadWorkspaceBundle(req.params.id);
    if (!bundle) {
      res.status(404).json({ error: 'Agent workspace not found.' });
      return;
    }
    res.json(bundle);
  });

  app.get('/api/agents/:id/chunks', (req, res) => {
    const chunks = loadChunks(req.params.id);
    const sanitized = chunks.map((c) => ({
      chunk_id: c.chunk_id,
      agent_id: c.agent_id,
      document_name: c.document_name,
      file_type: c.file_type,
      page_or_row: c.page_or_row,
      source_text: c.source_text,
      char_count: c.char_count,
      has_embedding: Array.isArray(c.embedding) && c.embedding.length > 0,
    }));
    res.json(sanitized);
  });

  // Step 1: Upload documents & start Intake Interviewer
  app.post('/api/factory/upload-and-intake', upload.array('files'), async (req, res) => {
    try {
      const brief = String(req.body.brief ?? '').trim();
      const additional_requirements = String(req.body.additional_requirements ?? '').trim();
      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];

      if (!brief || brief.length < 15) {
        res.status(400).json({ error: 'Please provide a descriptive assistant brief (at least 15 characters).' });
        return;
      }
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Please upload at least one PDF, DOCX, TXT, or CSV document.' });
        return;
      }

      const agent_id = `agent_${crypto.randomUUID().slice(0, 8)}`;
      const tracker = new BudgetTracker();
      const existingHashes = new Set<string>();
      const docs: DocumentFile[] = [];
      let allChunks: DocumentChunk[] = [];

      for (const f of uploadedFiles) {
        const cleanName = path.basename(f.originalname);
        const processed = await processUploadedFile({
          agent_id,
          filename: cleanName,
          buffer: f.buffer,
          existingHashes,
          is_demo: false,
        });

        if (processed.file.status === 'processed') {
          saveUploadedRawFile(agent_id, cleanName, f.buffer);
          const chunks = buildChunksFromSegments({
            agent_id,
            document_name: cleanName,
            file_type: processed.file.file_type,
            segments: processed.segments,
            chunk_size: processed.file.file_type === 'csv' ? 560 : 700,
            chunk_overlap: 120,
          });
          processed.file.chunk_count = chunks.length;
          allChunks.push(...chunks);
        }
        docs.push(processed.file);
      }

      if (allChunks.length === 0) {
        res.status(400).json({
          error: 'None of the uploaded files yielded extractable text.',
          documents: docs,
        });
        return;
      }

      allChunks = await indexChunksWithEmbeddings(allChunks, tracker);
      saveDocumentsMetadata(agent_id, docs);
      saveChunks(agent_id, allChunks);

      const intake = await generateClarificationQuestions({
        brief,
        additional_requirements,
        documents: docs,
        chunks: allChunks,
        tracker,
      });

      stagedSessions.set(agent_id, {
        brief,
        additional_requirements,
        documents: docs,
        chunks: allChunks,
        tracker,
      });

      res.json({
        agent_id,
        documents: docs,
        chunks_count: allChunks.length,
        questions: intake.questions,
        preliminary_notes: intake.preliminary_notes,
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed during document processing and intake.',
      });
    }
  });

  // Step 2: Finalize Intake & Run Groundability Guard
  app.post('/api/factory/:id/finalize-requirements', async (req, res) => {
    try {
      const agentId = req.params.id;
      const session = stagedSessions.get(agentId);
      const documents = session?.documents ?? loadDocumentsMetadata(agentId);
      const chunks = session?.chunks ?? loadChunks(agentId);
      const tracker = session?.tracker ?? new BudgetTracker();

      const brief = String(req.body.brief ?? session?.brief ?? '');
      const additional_requirements = String(
        req.body.additional_requirements ?? session?.additional_requirements ?? ''
      );
      const clarification_history = (req.body.clarification_history ?? []) as ClarificationTurn[];

      const requirements = await synthesizeRequirementsSpec({
        agent_id: agentId,
        brief,
        additional_requirements,
        documents,
        chunks,
        clarification_history,
        tracker,
      });

      const groundability = await runGroundabilityGuard({
        requirements,
        chunks,
        tracker,
      });

      saveRequirements(agentId, requirements);
      saveGroundability(agentId, groundability);

      res.json({ requirements, groundability });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to synthesize requirements or run Groundability Guard.',
      });
    }
  });

  // Step 2b: Human Approval Checkpoint (Edit & Approve Requirements)
  app.put('/api/factory/:id/requirements', async (req, res) => {
    try {
      const agentId = req.params.id;
      const updated = req.body as RequirementsSpec;
      updated.agent_id = agentId;
      updated.approved = true;
      saveRequirements(agentId, updated);

      const chunks = loadChunks(agentId);
      const groundability = await runGroundabilityGuard({
        requirements: updated,
        chunks,
      });
      saveGroundability(agentId, groundability);

      res.json({ requirements: updated, groundability });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to update approved requirements.',
      });
    }
  });

  // Step 3: Generate Agent, Run Prompt Tournament (optional), Generate 22+ Evals, Run Critic-Optimizer (<=3 iters), Report
  app.post('/api/factory/:id/generate-and-optimize', async (req, res) => {
    try {
      const agentId = req.params.id;
      const requirements = loadRequirements(agentId);
      const groundability = loadGroundability(agentId);
      const documents = loadDocumentsMetadata(agentId);
      const chunks = loadChunks(agentId);

      if (!requirements || !groundability || chunks.length === 0) {
        res.status(400).json({ error: 'Requirements, Groundability Guard, and indexed chunks must be completed first.' });
        return;
      }

      const enableTournament = Boolean(req.body.enable_prompt_tournament);
      const maxIterations = Math.min(3, Math.max(1, Number(req.body.max_iterations ?? 3)));
      const maxTokenBudget = Number(req.body.max_token_budget ?? 180000);

      const session = stagedSessions.get(agentId);
      const tracker = session?.tracker ?? new BudgetTracker();
      const csvSources = loadCsvSourcesForAgent(agentId);

      requirements.approved = true;
      saveRequirements(agentId, requirements);

      let agent = await generateAgentDefinition({
        requirements,
        groundability,
        documents,
        tracker,
      });
      agent.status = 'evaluating';
      saveAgentDefinition(agent);

      const evalCases = await generateEvaluationSuite({
        agent,
        requirements,
        groundability,
        chunks,
        tracker,
      });
      saveEvalDataset(agentId, evalCases);

      let tournamentResults;
      if (enableTournament) {
        const tourney = await runPromptTournament({
          baseAgent: agent,
          requirements,
          testCases: evalCases,
          chunks,
          csvSources,
          tracker,
        });
        agent = tourney.bestAgent;
        tournamentResults = tourney.tournamentResults;
      }

      agent.status = 'optimizing';
      saveAgentDefinition(agent);

      const opt = await runCriticOptimizerLoop({
        agent,
        testCases: evalCases,
        chunks,
        csvSources,
        tracker,
        maxIterations,
        maxTokenBudget,
        onVersionSnapshot: (snapAgent, reason, score) => {
          saveAgentVersionSnapshot(snapAgent, reason, score);
        },
      });

      saveAgentDefinition(opt.finalAgent);
      saveEvalResults(agentId, opt.finalResults);
      saveOptimizationLogs(agentId, opt.iterations);

      const qualityReport = buildQualityReport({
        agent: opt.finalAgent,
        results: opt.finalResults,
        iterations: opt.iterations,
        tracker,
        promptTournament: tournamentResults,
        documents,
      });
      saveQualityReport(agentId, qualityReport);

      // Seed initial Trust Ledger probe from first answerable + first out_of_scope case
      const firstAns = evalCases.find((c) => c.category === 'answerable');
      const firstOos = evalCases.find((c) => c.category === 'out_of_scope');
      for (const probe of [firstAns, firstOos]) {
        if (probe) {
          const turn = await runAgentTurn({
            agent: opt.finalAgent,
            question: probe.question,
            chunks,
            csvSources,
            tracker,
          });
          appendTrustLedgerEntry(agentId, turn.trust_ledger);
        }
      }

      stagedSessions.delete(agentId);
      res.json(loadWorkspaceBundle(agentId));
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Agent generation & optimization failed.',
      });
    }
  });

  // Re-run live evaluation & optimization on any existing agent (including demos!)
  app.post('/api/agents/:id/re-evaluate', async (req, res) => {
    try {
      const agentId = req.params.id;
      const agent = loadAgentDefinition(agentId);
      const evalCases = loadEvalDataset(agentId);
      const documents = loadDocumentsMetadata(agentId);
      const rawChunks = loadChunks(agentId);
      if (!agent || evalCases.length === 0) {
        res.status(404).json({ error: 'Agent or evaluation suite not found.' });
        return;
      }
      const csvSources = loadCsvSourcesForAgent(agentId);
      const tracker = new BudgetTracker();
      const ensured = await ensureChunkEmbeddings(rawChunks, tracker);
      if (ensured.updated) {
        saveChunks(agentId, ensured.chunks);
      }

      const maxIterations = Math.min(3, Math.max(1, Number(req.body.max_iterations ?? 2)));

      const opt = await runCriticOptimizerLoop({
        agent,
        testCases: evalCases,
        chunks: ensured.chunks,
        csvSources,
        tracker,
        maxIterations,
        onVersionSnapshot: (snapAgent, reason, score) => {
          saveAgentVersionSnapshot(snapAgent, reason, score);
        },
      });

      saveAgentDefinition(opt.finalAgent);
      saveEvalResults(agentId, opt.finalResults);
      saveOptimizationLogs(agentId, opt.iterations);

      const qualityReport = buildQualityReport({
        agent: opt.finalAgent,
        results: opt.finalResults,
        iterations: opt.iterations,
        tracker,
        documents,
      });
      saveQualityReport(agentId, qualityReport);

      res.json(loadWorkspaceBundle(agentId));
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Re-evaluation failed.',
      });
    }
  });

  // Agent Versioning & Rollback Endpoints
  app.get('/api/agents/:id/versions', (req, res) => {
    const versions = loadAgentVersions(req.params.id);
    res.json(versions);
  });

  app.post('/api/agents/:id/rollback/:version', (req, res) => {
    const agentId = req.params.id;
    const targetVersion = Number(req.params.version);
    if (!Number.isFinite(targetVersion)) {
      res.status(400).json({ error: 'Invalid version number.' });
      return;
    }
    const restored = rollbackAgentToVersion(agentId, targetVersion);
    if (!restored) {
      res.status(404).json({ error: `Version v${targetVersion} not found for agent ${agentId}.` });
      return;
    }
    res.json(loadWorkspaceBundle(agentId));
  });

  // Regression Mode: Upload updated/new docs to existing agent and re-run old eval set
  app.post('/api/agents/:id/regression', upload.array('files'), async (req, res) => {
    try {
      const agentId = req.params.id;
      const agent = loadAgentDefinition(agentId);
      const evalCases = loadEvalDataset(agentId);
      const prevResults = loadEvalResults(agentId);
      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];

      if (!agent || evalCases.length === 0) {
        res.status(404).json({ error: 'Agent or baseline eval dataset not found.' });
        return;
      }
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Upload at least one updated document for regression testing.' });
        return;
      }

      const existingDocs = loadDocumentsMetadata(agentId);
      const existingChunks = loadChunks(agentId);
      const existingHashes = new Set(existingDocs.map((d) => d.sha256));
      const newDocs: DocumentFile[] = [];
      let addedChunks: DocumentChunk[] = [];

      for (const f of uploadedFiles) {
        const cleanName = path.basename(f.originalname);
        const processed = await processUploadedFile({
          agent_id: agentId,
          filename: cleanName,
          buffer: f.buffer,
          existingHashes,
          is_demo: false,
        });
        if (processed.file.status === 'processed') {
          saveUploadedRawFile(agentId, cleanName, f.buffer);
          const built = buildChunksFromSegments({
            agent_id: agentId,
            document_name: cleanName,
            file_type: processed.file.file_type,
            segments: processed.segments,
            chunk_size: agent.retrieval_config.chunk_size,
            chunk_overlap: agent.retrieval_config.chunk_overlap,
          });
          processed.file.chunk_count = built.length;
          addedChunks.push(...built);
        }
        newDocs.push(processed.file);
      }

      const tracker = new BudgetTracker();
      if (addedChunks.length > 0) {
        addedChunks = await indexChunksWithEmbeddings(addedChunks, tracker);
      }

      const mergedDocs = [
        ...existingDocs.filter((d) => !newDocs.some((nd) => nd.filename === d.filename && nd.status === 'processed')),
        ...newDocs,
      ];
      const mergedChunks = [
        ...existingChunks.filter((c) => !newDocs.some((nd) => nd.filename === c.document_name && nd.status === 'processed')),
        ...addedChunks,
      ];

      saveDocumentsMetadata(agentId, mergedDocs);
      saveChunks(agentId, mergedChunks);

      const csvSources = loadCsvSourcesForAgent(agentId);
      const newResults = await evaluateAgentOnSuite({
        agent,
        testCases: evalCases,
        chunks: mergedChunks,
        csvSources,
        tracker,
      });

      const prevScore = computeOverallScore(prevResults);
      const newScore = computeOverallScore(newResults);
      const prevMap = new Map(prevResults.map((r) => [r.test_id, r]));

      const regressions: RegressionResult['regressions'] = [];
      let improvements = 0;
      let unchanged = 0;

      for (const nr of newResults) {
        const pr = prevMap.get(nr.test_id);
        if (!pr) continue;
        if (pr.passed && !nr.passed) {
          regressions.push({
            test_id: nr.test_id,
            question: nr.question,
            previous_passed: pr.passed,
            new_passed: nr.passed,
            previous_score: pr.scores.overall,
            new_score: nr.scores.overall,
            reason: nr.failure_explanation,
          });
        } else if (!pr.passed && nr.passed) {
          improvements += 1;
        } else {
          unchanged += 1;
        }
      }

      const regResult: RegressionResult = {
        agent_id: agentId,
        run_at: new Date().toISOString(),
        previous_score: prevScore,
        new_score: newScore,
        total_cases: newResults.length,
        regressions,
        improvements,
        unchanged,
      };
      saveRegressionResult(agentId, regResult);
      saveEvalResults(agentId, newResults);

      res.json({ regression: regResult, bundle: loadWorkspaceBundle(agentId) });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Regression run failed.',
      });
    }
  });

  // Factory vs. Human Baseline Head-to-Head Benchmark
  app.post('/api/agents/:id/compare-baseline', async (req, res) => {
    try {
      const agentId = req.params.id;
      const agent = loadAgentDefinition(agentId);
      const evalCases = loadEvalDataset(agentId);
      const factoryResults = loadEvalResults(agentId);
      const chunks = loadChunks(agentId);

      if (!agent || evalCases.length === 0 || factoryResults.length === 0) {
        res.status(404).json({ error: 'Agent or baseline evaluation results not found.' });
        return;
      }

      const csvSources = loadCsvSourcesForAgent(agentId);
      const customHumanPrompt =
        typeof req.body?.human_system_prompt === 'string'
          ? req.body.human_system_prompt
          : undefined;

      const comparison = await runFactoryVsHumanBaseline({
        factoryAgent: agent,
        factoryResults,
        testCases: evalCases,
        chunks,
        csvSources,
        customHumanPrompt,
      });

      saveBaselineComparison(agentId, comparison);
      res.json({ comparison, bundle: loadWorkspaceBundle(agentId) });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Baseline comparison failed.',
      });
    }
  });

  // Live Generic Agent Runner + Trust Ledger
  app.post('/api/agents/:id/chat', async (req, res) => {
    try {
      const agentId = req.params.id;
      const agent = loadAgentDefinition(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent definition not found.' });
        return;
      }

      const question = String(req.body.question ?? '').trim();
      const history = (req.body.history ?? []) as Array<{ role: 'user' | 'assistant'; text: string }>;
      if (!question) {
        res.status(400).json({ error: 'Question cannot be empty.' });
        return;
      }

      const rawChunks = loadChunks(agentId);
      const csvSources = loadCsvSourcesForAgent(agentId);
      const tracker = new BudgetTracker();
      const ensured = await ensureChunkEmbeddings(rawChunks, tracker);
      if (ensured.updated) {
        saveChunks(agentId, ensured.chunks);
      }

      const turn = await runAgentTurn({
        agent,
        question,
        chunks: ensured.chunks,
        csvSources,
        history,
        tracker,
        useEmbeddings: true,
        skipTrustLlmCheck: false,
      });

      appendTrustLedgerEntry(agentId, turn.trust_ledger);
      res.json(turn);
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Agent execution error.',
      });
    }
  });

  // Export Artifacts (JSON & CSV Scorecard)
  app.get('/api/agents/:id/export/:artifact', (req, res) => {
    const agentId = req.params.id;
    const artifact = req.params.artifact;

    if (artifact === 'agent_definition.json') {
      const data = loadAgentDefinition(agentId);
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_definition.json"`);
      return res.json(data);
    }
    if (artifact === 'agent_config.json') {
      const agent = loadAgentDefinition(agentId);
      if (!agent) return res.status(404).json({ error: 'Not found' });
      const requirements = loadRequirements(agentId);
      const groundability = loadGroundability(agentId);
      const payload = {
        exported_at: new Date().toISOString(),
        agent_definition: agent,
        configuration: {
          retrieval_config: agent.retrieval_config,
          selected_tools: agent.selected_tools,
          refusal_rules: agent.refusal_rules,
          output_contract: agent.output_contract,
          source_citation_requirements: agent.source_citation_requirements,
          known_limitations: agent.known_limitations,
        },
        requirements_summary: requirements
          ? {
              scope: requirements.scope,
              target_audience: requirements.target_audience,
              tone: requirements.tone,
              supported_topics: requirements.supported_topics,
              unsupported_topics: requirements.unsupported_topics,
              approved: requirements.approved,
            }
          : null,
        groundability_summary: groundability
          ? {
              overall_groundability_pct: groundability.overall_groundability_pct,
              flagged_gaps: groundability.flagged_gaps,
            }
          : null,
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_config.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }
    if (artifact === 'requirements.json') {
      const data = loadRequirements(agentId);
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_requirements.json"`);
      return res.json(data);
    }
    if (artifact === 'groundability_report.json') {
      const data = loadGroundability(agentId);
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_groundability.json"`);
      return res.json(data);
    }
    if (artifact === 'eval_dataset.json') {
      const data = loadEvalDataset(agentId);
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_eval_dataset.json"`);
      return res.json(data);
    }
    if (artifact === 'quality_report.json') {
      const data = loadQualityReport(agentId);
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_quality_report.json"`);
      return res.json(data);
    }
    if (artifact === 'scorecard.csv') {
      const results = loadEvalResults(agentId);
      const header =
        'test_id,category,expected_refusal,passed,failure_category,grounding,correctness,refusal_accuracy,citation_accuracy,relevance,overall\n';
      const rows = results
        .map(
          (r) =>
            `${r.test_id},${r.category},${r.expected_refusal},${r.passed},${r.failure_category},${r.scores.grounding},${r.scores.correctness},${r.scores.refusal_accuracy},${r.scores.citation_accuracy},${r.scores.relevance},${r.scores.overall}`
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${agentId}_scorecard.csv"`);
      return res.send(header + rows);
    }

    res.status(400).json({ error: 'Unknown export artifact requested.' });
  });

  app.delete('/api/agents/:id', (req, res) => {
    deleteAgentWorkspace(req.params.id);
    res.json({ deleted: true });
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ForgeAI Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ForgeAI server:', err);
  process.exit(1);
});
