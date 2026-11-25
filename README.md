# ForgeAI — Autonomous AI Agent Factory

ForgeAI is an autonomous AI agent factory that takes a one-paragraph brief and a folder of documents (PDF, DOCX, TXT, CSV) and automatically builds, tests, improves, and deploys a working, evidence-grounded AI agent.

## Architecture & Core Modules

1. **Intake Interviewer (`server/core/intake.ts`, `prompts/intake_prompt.txt`)**:
   - Inspects the user brief and uploaded document previews.
   - Asks up to 5 high-value clarification questions (skipping questions if the brief is already clear).
   - Generates a structured `RequirementsSpec` (`agent_name`, `scope`, `target_audience`, `tone`, `must_answer_topics`, `must_refuse_topics`, `required_tools`, `limitations`, `clarification_history`).
   - Includes a Human Approval Checkpoint allowing edits before agent generation.

2. **Groundability Guard (`server/core/groundability.ts`, `prompts/groundability_prompt.txt`)**:
   - Audits every requested topic against retrieved document chunks before agent generation.
   - Classifies each topic as `Fully supported`, `Partially supported`, `Not supported`, or `Conflicting information`.
   - Flags unsupported gaps so the generated agent refuses missing topics rather than hallucinating.

3. **Document Intelligence (`server/core/documentProcessor.ts`, `server/core/retrieval.ts`)**:
   - Extracts text from PDF (`pdfjs-dist`), DOCX (`mammoth`), TXT, and CSV (`csv-parse`).
   - Handles empty files, unsupported formats, duplicate SHA-256 hashes, and parse errors gracefully.
   - Preserves `document_name`, `page_or_row`, `chunk_id`, and `source_text`.
   - Indexes chunks with `gemini-embedding-2` and executes hybrid semantic + lexical retrieval.

4. **Agent Generator & Tool Registry (`server/core/agentGenerator.ts`, `server/core/tools.ts`)**:
   - Produces a declarative `AgentDefinition` JSON with system prompt, refusal rules, retrieval config, output contract, and citation format.
   - Attaches only required tools from the 4-tool registry:
     - `csv_lookup`: Structured CSV row search
     - `calculator`: Safe recursive-descent arithmetic evaluator
     - `public_weather`: Keyless Open-Meteo HTTP forecast API
     - `current_date`: UTC calendar date and timestamp

5. **Automatic Evaluation Generator (`server/core/evalGenerator.ts`, `prompts/eval_generation_prompt.txt`)**:
   - Dynamically generates 22+ validated test cases across `answerable`, `out_of_scope`, and `edge_case` categories.

6. **Automated Hybrid Judge (`server/core/judge.ts`, `prompts/judge_prompt.txt`)**:
   - Combines deterministic fact overlap, citation regex, and refusal detection with LLM-as-judge grading defended against verbosity, position, and self-preference bias.

7. **Critic & Optimizer (`server/core/criticOptimizer.ts`, `prompts/critic_prompt.txt`)**:
   - Runs up to 3 surgical optimization iterations targeting `retrieval_miss`, `prompt_defect`, `hallucination`, `wrong_refusal`, `incorrect_citation`, and `incomplete_answer`.
   - Logs exact diffs and before/after scores without inflating results.

8. **Generic Agent Runner & Trust Ledger (`server/core/agentRunner.ts`, `server/core/trustLedger.ts`)**:
   - Executes any generated `AgentDefinition` JSON dynamically.
   - Audits every answer in the **Trust Ledger** with `GREEN` (Supported by evidence), `YELLOW` (Partially supported / uncertain), or `RED` (Unsupported / refusal required).

## Included Complete Demonstrations

- **Demo 1 — ShoreStaff HR Policy Assistant (`demo_hr_policy_assistant`)**: Covers leave, attendance, and workplace conduct while flagging unsupported medical/dental insurance gaps.
- **Demo 2 — Marine Spares Procurement Assistant (`demo_ship_spares_procurement`)**: Combines `marine_spares_catalogue.csv` (`csv_lookup` + `calculator`) with supplier qualification and PO compliance SOPs.

## Running Locally

```bash
npm install
# Set GEMINI_API_KEY in environment or .env
npm run dev
```

Build and typecheck:

```bash
npm run lint
npm run build
```
