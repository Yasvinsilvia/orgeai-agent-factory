import type {
  AgentDefinition,
  DocumentChunk,
  DocumentFile,
  EvalCaseResult,
  EvalTestCase,
  GroundabilityReport,
  HumanBaselineComparison,
  OptimizationIteration,
  QualityReport,
  RequirementsSpec,
  TrustLedgerEntry,
} from '../../src/types/forge.ts';
import { buildPipelineIntegrityAudit } from './criticOptimizer.ts';
import { processUploadedFile } from './documentProcessor.ts';
import { buildChunksFromSegments } from './retrieval.ts';
import {
  loadAgentDefinition,
  saveAgentDefinition,
  saveBaselineComparison,
  saveChunks,
  saveDocumentsMetadata,
  saveEvalDataset,
  saveEvalResults,
  saveGroundability,
  saveOptimizationLogs,
  saveQualityReport,
  saveRequirements,
  saveTrustLedger,
  saveUploadedRawFile,
} from './storage.ts';

async function indexDemoFiles(
  agentId: string,
  files: Array<{ filename: string; content: string }>,
  chunkSize: number,
  chunkOverlap: number
): Promise<{ docs: DocumentFile[]; chunks: DocumentChunk[] }> {
  const existingHashes = new Set<string>();
  const docs: DocumentFile[] = [];
  const allChunks: DocumentChunk[] = [];

  for (const f of files) {
    const buf = Buffer.from(f.content, 'utf-8');
    saveUploadedRawFile(agentId, f.filename, buf);
    const processed = await processUploadedFile({
      agent_id: agentId,
      filename: f.filename,
      buffer: buf,
      existingHashes,
      is_demo: true,
    });
    const chunks = buildChunksFromSegments({
      agent_id: agentId,
      document_name: f.filename,
      file_type: processed.file.file_type,
      segments: processed.segments,
      chunk_size: chunkSize,
      chunk_overlap: chunkOverlap,
    });
    processed.file.chunk_count = chunks.length;
    docs.push(processed.file);
    allChunks.push(...chunks);
  }

  return { docs, chunks: allChunks };
}

export async function seedInitialDemosIfMissing() {
  await seedHrDemo();
  await seedProcurementDemo();
  await seedVoyageComplianceDemo();
}

async function seedHrDemo() {
  const agentId = 'demo_hr_policy_assistant';
  if (loadAgentDefinition(agentId)) return;

  const files = [
    {
      filename: 'HR_Leave_Policy_2026.txt',
      content: `[DEMO SAMPLE DATA - Synthesized for ForgeAI HR Policy Demonstration]
OCEANIC SHORE OPERATIONS — LEAVE POLICY (EFFECTIVE 2026)

1. Annual Paid Leave
Full-time shore staff receive 22 working days of paid annual leave per calendar year, accrued monthly at 1.83 days per month. Employees with 5 or more years of continuous service receive 25 working days. Unused annual leave up to a maximum of 5 days may be carried over into Q1 of the following year (must be used by March 31); any excess above 5 days expires on December 31 unless deferred in writing by the Department Head. Leave requests of 1 to 3 days require at least 5 working days advance notice; requests of 4 or more consecutive days require 15 working days advance notice via the HR Portal.

2. Sick Leave and Medical Certificates
Shore employees are entitled to 12 days of paid sick leave per year. Absence of 1 to 2 consecutive days may be self-certified before 10:00 AM by notifying the line manager. Absences of 3 or more consecutive days require a registered physician medical certificate submitted within 48 hours of returning to work. Unused sick leave is not encashable and does not carry over.

3. Parental and Bereavement Leave
Primary caregivers receive 16 weeks of fully paid parental leave; secondary caregivers receive 4 weeks of paid paternity/partner leave within 6 months of birth or adoption. Bereavement leave is 5 paid working days for immediate family (spouse, parent, child, sibling) and 2 days for extended relatives.`,
    },
    {
      filename: 'Attendance_and_Shift_Handbook.txt',
      content: `[DEMO SAMPLE DATA - Synthesized for ForgeAI HR Policy Demonstration]
OCEANIC SHORE OPERATIONS — ATTENDANCE & HYBRID WORK HANDBOOK

1. Core Office Hours and Grace Period
Standard working hours for shore staff are 09:30 to 17:30 Monday through Friday (including a 45-minute lunch break). A 15-minute morning grace period (until 09:45) is permitted up to 3 times per calendar month. Arrivals after 09:45 without prior manager approval are logged as late attendance; 4 unexcused late arrivals in a month trigger a formal HR attendance warning.

2. Hybrid and Remote Work Policy
Confirmed employees who have completed their 90-day probation period may work remotely up to 2 days per week (Tuesday or Thursday preferred, never consecutive Mondays and Fridays without Director sign-off). Employees must remain reachable on company messaging within 15 minutes during core hours (10:00–16:00).

3. Overtime and Public Holidays
Overtime requires written pre-approval from the Team Lead and applies only to non-exempt operational coordinators. Approved weekday overtime is compensated at 1.5x hourly rate or equivalent time-off-in-lieu (TOIL) taken within 60 days. Public holiday work is compensated at 2.0x rate plus 1 compensatory day off.`,
    },
    {
      filename: 'Workplace_Code_of_Conduct.txt',
      content: `[DEMO SAMPLE DATA - Synthesized for ForgeAI HR Policy Demonstration]
OCEANIC SHORE OPERATIONS — WORKPLACE CONDUCT & EXPENSE GUIDELINES

1. Grievance Escalation
Workplace harassment, safety, or policy grievances must be reported to HR People Operations or via the confidential ethics inbox. HR acknowledges all written grievances within 24 hours and assigns an independent investigator within 48 hours. Retaliation against good-faith reporters is grounds for immediate termination.

2. Business Travel & Meal Allowances
Approved domestic day-trip meal reimbursement is capped at $35 USD per day with itemized receipts; overnight domestic hotel reimbursement is capped at $190 USD per night. Alcohol is strictly excluded from reimbursable expense claims. Expense claims must be submitted within 14 calendar days of travel completion.

3. Information Security
Company laptops must use full-disk encryption and auto-lock after 5 minutes of inactivity. Connecting personal USB storage devices to corporate terminals is prohibited.`,
    },
  ];

  const { docs, chunks } = await indexDemoFiles(agentId, files, 700, 120);
  saveDocumentsMetadata(agentId, docs);
  saveChunks(agentId, chunks);

  const requirements: RequirementsSpec = {
    agent_id: agentId,
    original_brief:
      'Create an HR assistant for shore staff employees that answers questions about leave, attendance, workplace policies, and employee dental/medical insurance coverage.',
    additional_requirements:
      'Must refuse unsupported topics rather than guessing from general HR knowledge. Include exact citations.',
    agent_name: 'ShoreStaff HR Policy Assistant',
    agent_purpose:
      'Answer shore staff questions accurately regarding annual/sick/parental leave, attendance rules, hybrid work, grievances, and expense caps using internal HR documents.',
    scope: 'Internal Oceanic Shore Operations HR policies (2026) covering leave, attendance, hybrid work, conduct, and expenses.',
    target_audience: 'Shore-based corporate and operations employees',
    tone: 'Clear, professional, policy-accurate, and concise',
    must_answer_topics: [
      'Annual leave accrual, carry-over, and notice periods',
      'Sick leave allowance and medical certificate rules',
      'Parental and bereavement leave entitlements',
      'Core office hours, grace period, and hybrid/remote work rules',
      'Overtime compensation and grievance escalation timelines',
      'Employee dental and medical insurance coverage',
    ],
    must_refuse_topics: [
      'Employee medical, dental, or vision insurance plans (not present in uploaded documents)',
      'Salary bands, equity grants, or individual payroll records',
      'Seafarer / offshore vessel crew contracts',
    ],
    supported_topics: [
      'Annual, sick, parental, and bereavement leave',
      'Core hours, grace period, late arrivals, and hybrid work',
      'Overtime, TOIL, grievance escalation, and travel meal/hotel caps',
    ],
    unsupported_topics: ['Employee medical, dental, and vision insurance coverage'],
    required_tools: ['current_date'],
    limitations: [
      'Medical, dental, and vision insurance plan details are NOT available in the uploaded documents; the agent refuses queries on insurance coverage.',
      'Covers shore staff only; offshore crew policies are not included.',
    ],
    clarification_history: [
      {
        question: 'Should the assistant cover offshore vessel crew or strictly shore-based employees?',
        answer: 'Strictly shore-based employees.',
      },
      {
        question: 'How should the agent respond if an employee asks about medical or dental insurance benefits?',
        answer: 'Refuse clearly and state that insurance documents were not provided.',
      },
    ],
    approved: true,
    created_at: '2026-11-20T09:00:00.000Z',
  };
  saveRequirements(agentId, requirements);

  const groundability: GroundabilityReport = {
    agent_id: agentId,
    overall_groundability_pct: 83,
    checks: [
      {
        topic: 'Annual leave accrual, carry-over, and notice periods',
        status: 'Fully supported',
        evidence: ['22 working days annual leave; 25 after 5 years; max 5 days carry-over used by March 31; 5 or 15 days notice.'],
        source_documents: ['HR_Leave_Policy_2026.txt'],
        explanation: 'All entitlement numbers, carry-over caps, and notice thresholds are explicitly defined in Section 1.',
      },
      {
        topic: 'Sick leave allowance and medical certificate rules',
        status: 'Fully supported',
        evidence: ['12 days paid sick leave; 1-2 days self-certified before 10:00 AM; 3+ days requires physician certificate within 48h.'],
        source_documents: ['HR_Leave_Policy_2026.txt'],
        explanation: 'Complete rules documented in Section 2.',
      },
      {
        topic: 'Parental and bereavement leave entitlements',
        status: 'Fully supported',
        evidence: ['16 weeks primary caregiver, 4 weeks secondary caregiver; 5 days immediate family, 2 days extended.'],
        source_documents: ['HR_Leave_Policy_2026.txt'],
        explanation: 'Fully detailed in Section 3.',
      },
      {
        topic: 'Core office hours, grace period, and hybrid/remote work rules',
        status: 'Fully supported',
        evidence: ['09:30-17:30 core hours, 15-min grace period 3x/month, 2 days/week remote after 90-day probation.'],
        source_documents: ['Attendance_and_Shift_Handbook.txt'],
        explanation: 'Explicitly covered in Sections 1 and 2.',
      },
      {
        topic: 'Overtime compensation and grievance escalation timelines',
        status: 'Fully supported',
        evidence: ['1.5x weekday overtime or TOIL within 60 days; 2.0x public holiday; grievance acknowledged 24h, investigator 48h.'],
        source_documents: ['Attendance_and_Shift_Handbook.txt', 'Workplace_Code_of_Conduct.txt'],
        explanation: 'Cross-document facts present across Attendance Handbook and Code of Conduct.',
      },
      {
        topic: 'Employee dental and medical insurance coverage',
        status: 'Not supported',
        evidence: [],
        source_documents: [],
        explanation: 'Zero documents mention health, dental, or vision insurance plans, premiums, or providers. Flagged as a hard refusal gap.',
      },
    ],
    flagged_gaps: [
      'Medical and dental insurance information is not available in the uploaded documents. The generated agent will refuse unsupported medical insurance questions.',
    ],
    warnings: [
      '1 of 6 requested topics ("Employee dental and medical insurance coverage") has zero document support.',
    ],
    generated_at: '2026-11-20T09:02:00.000Z',
  };
  saveGroundability(agentId, groundability);

  const agent: AgentDefinition = {
    id: agentId,
    agent_name: 'ShoreStaff HR Policy Assistant',
    description:
      'Answers shore staff HR policy questions strictly from verified Oceanic Shore Operations leave, attendance, and workplace conduct documents.',
    system_prompt: `You are the ShoreStaff HR Policy Assistant for Oceanic Shore Operations.
Answer employee questions strictly using the retrieved HR policy passages and the current_date tool when relative dates are needed.

Mandatory Rules:
1. Cite every factual statement inline using [DocumentName, Page/Row].
2. Never use general HR assumptions to fill missing policies. If asked about medical, dental, or vision insurance, salary bands, or offshore crew rules, refuse clearly by stating that those topics are not covered in the uploaded HR policy documents.
3. For multi-part questions spanning leave, attendance, and conduct, synthesize all applicable sections and cite each source document.

[Targeted Optimization Patch #1]
When answering multi-condition questions (such as combining probation eligibility with remote work or carry-over deadlines), verify all numeric thresholds (days, hours, percentages) in the retrieved chunks before answering.

[Targeted Optimization Patch #2]
Always verify whether a query asks about an excluded item (such as alcohol in expense claims or encashing unused sick leave) and explicitly state the prohibition with its exact source citation.`,
    target_audience: 'Shore-based corporate and operations employees',
    tone: 'Clear, professional, and policy-accurate',
    supported_topics: requirements.supported_topics,
    refusal_rules: [
      'Refuse questions about medical, dental, or vision insurance plans (not present in uploaded documents).',
      'Refuse questions about individual salaries, bonuses, or offshore seafarer contracts.',
      'Refuse unrelated external topics (weather, stock market, general trivia).',
    ],
    retrieval_config: {
      chunk_size: 700,
      chunk_overlap: 120,
      top_k: 5,
      similarity_threshold: 0.18,
    },
    selected_tools: ['current_date'],
    output_contract:
      'Direct answer with exact figures/timelines, inline [DocumentName, Page/Row] citations for every claim, or an explicit refusal citing the missing document scope.',
    source_citation_requirements:
      'Every factual claim must include [DocumentName, Section/Page] matching the retrieved chunks.',
    known_limitations: [
      'Medical, dental, and vision insurance coverage is not included in the uploaded documents.',
      'Complex multi-document policy interactions involving unwritten exceptions cannot be resolved.',
    ],
    version: 3,
    status: 'ready',
    is_demo: true,
    created_at: '2026-11-20T09:05:00.000Z',
    updated_at: '2026-11-20T09:12:00.000Z',
  };
  saveAgentDefinition(agent);

  const evalCases: EvalTestCase[] = [
    {
      test_id: 'EVAL-01',
      question: 'How many annual paid leave days do full-time shore staff receive per year?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: 'State 22 working days per year (1.83 days/month) and 25 days after 5 years.',
      expected_facts: ['22 working days', '1.83 days', '25 working days'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-02',
      question: 'What is the maximum number of unused annual leave days that can be carried over, and by when must they be used?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: 'State max 5 days carried over into Q1, must be used by March 31.',
      expected_facts: ['5 days', 'March 31'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-03',
      question: 'When is a physician medical certificate required for sick leave?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: 'Required for 3 or more consecutive days within 48 hours of return.',
      expected_facts: ['3 or more consecutive days', '48 hours'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-04',
      question: 'How long is paid parental leave for primary and secondary caregivers?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: '16 weeks primary caregiver, 4 weeks secondary caregiver within 6 months.',
      expected_facts: ['16 weeks', '4 weeks'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-05',
      question: 'What are the standard core office hours and morning grace period?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: '09:30 to 17:30 with 15-minute grace period until 09:45 up to 3 times per month.',
      expected_facts: ['09:30', '17:30', '15-minute', '3 times'],
      expected_source_documents: ['Attendance_and_Shift_Handbook.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-06',
      question: 'Who is eligible for hybrid remote work and how many days per week are allowed?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: 'Confirmed employees after 90-day probation; up to 2 days per week.',
      expected_facts: ['90-day probation', '2 days per week'],
      expected_source_documents: ['Attendance_and_Shift_Handbook.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-07',
      question: 'How quickly does HR acknowledge a written grievance and assign an investigator?',
      category: 'answerable',
      subcategory: 'single_section_factual',
      expected_behavior: 'Acknowledged within 24 hours; investigator assigned within 48 hours.',
      expected_facts: ['24 hours', '48 hours'],
      expected_source_documents: ['Workplace_Code_of_Conduct.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-08',
      question: 'What are the daily meal and hotel reimbursement caps for domestic business travel, and what is the submission deadline?',
      category: 'answerable',
      subcategory: 'multi_section_synthesis',
      expected_behavior: '$35/day meal cap, $190/night hotel cap, submit within 14 calendar days.',
      expected_facts: ['$35', '$190', '14 calendar days'],
      expected_source_documents: ['Workplace_Code_of_Conduct.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-09',
      question: 'If a non-exempt coordinator works approved overtime on a public holiday and later takes a 5-day annual leave, what compensation and notice periods apply?',
      category: 'answerable',
      subcategory: 'cross_document_synthesis',
      expected_behavior: 'Combine 2.0x public holiday pay + 1 compensatory day off with 15 working days advance notice for 4+ days leave.',
      expected_facts: ['2.0x', '1 compensatory day', '15 working days'],
      expected_source_documents: ['Attendance_and_Shift_Handbook.txt', 'HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-10',
      question: 'Compare notice rules for 2-day self-certified sick leave vs 2-day annual leave.',
      category: 'answerable',
      subcategory: 'multi_section_synthesis',
      expected_behavior: 'Sick leave 1-2 days self-certified before 10:00 AM; annual leave 1-3 days requires 5 working days notice.',
      expected_facts: ['10:00 AM', '5 working days'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-11',
      question: 'What dental and vision insurance benefits do shore employees receive?',
      category: 'out_of_scope',
      subcategory: 'unsupported_flagged_gap',
      expected_behavior: 'Refuse clearly stating medical/dental/vision insurance is not in the uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-12',
      question: 'What is the deductible for inpatient hospitalization under our corporate health plan?',
      category: 'out_of_scope',
      subcategory: 'unsupported_flagged_gap',
      expected_behavior: 'Refuse because health insurance plan details are not in uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-13',
      question: 'What is the standard salary band for a Senior Operations Coordinator?',
      category: 'out_of_scope',
      subcategory: 'unrelated_hr_domain',
      expected_behavior: 'Refuse because compensation/salary bands are not in the uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-14',
      question: 'What is the weather forecast in Singapore for tomorrow?',
      category: 'out_of_scope',
      subcategory: 'unrelated_external',
      expected_behavior: 'Refuse unrelated weather request (weather tool is intentionally not attached).',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-15',
      question: 'How many days of shore leave do offshore chief engineers get per vessel rotation?',
      category: 'out_of_scope',
      subcategory: 'audience_boundary',
      expected_behavior: 'Refuse because policies apply to shore staff only, not offshore vessel crew.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-16',
      question: 'Can you summarize standard US FMLA leave laws for our US office?',
      category: 'out_of_scope',
      subcategory: 'external_knowledge_coaxing',
      expected_behavior: 'Refuse external statutory law not present in the uploaded company policies.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-17',
      question: 'Can I cash out my 12 unused sick leave days at the end of the year?',
      category: 'edge_case',
      subcategory: 'false_premise',
      expected_behavior: 'Correct the premise: unused sick leave is not encashable and does not carry over.',
      expected_facts: ['not encashable', 'does not carry over'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-18',
      question: 'I worked 15 days this month and took 1 day off—how much leave notice do I need if I want a week off next month, and can I take remote days on Monday and Friday back-to-back?',
      category: 'edge_case',
      subcategory: 'multi_constraint_boundary',
      expected_behavior: 'State 15 working days notice for 4+ days leave, and consecutive Monday/Friday remote days require Director sign-off.',
      expected_facts: ['15 working days', 'Director sign-off'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt', 'Attendance_and_Shift_Handbook.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-19',
      question: 'I arrived at 09:43 four times this month—do I get a formal HR warning?',
      category: 'edge_case',
      subcategory: 'numeric_boundary',
      expected_behavior: '09:43 is within the 09:45 grace period, which is permitted only 3 times per month; the 4th time exceeds the 3x/month allowance.',
      expected_facts: ['09:45', '3 times', '4'],
      expected_source_documents: ['Attendance_and_Shift_Handbook.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-20',
      question: 'Can I expense a $30 client dinner that included two glasses of wine?',
      category: 'edge_case',
      subcategory: 'exclusion_rule',
      expected_behavior: 'Meal is under $35 cap, but alcohol is strictly excluded from reimbursable expense claims.',
      expected_facts: ['$35', 'alcohol is strictly excluded'],
      expected_source_documents: ['Workplace_Code_of_Conduct.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-21',
      question: 'What happens to my time off?',
      category: 'edge_case',
      subcategory: 'ambiguous_underspecified',
      expected_behavior: 'Ask for clarification or summarize key leave carry-over/expiry rules (5 days carry-over by March 31, excess expires Dec 31).',
      expected_facts: ['5 days', 'March 31'],
      expected_source_documents: ['HR_Leave_Policy_2026.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-22',
      question: 'If I am still on my 60-day probation and want to submit a USB-backed expense report from home, which rules apply?',
      category: 'edge_case',
      subcategory: 'cross_document_conflict_check',
      expected_behavior: 'Remote work requires completing 90-day probation; personal USB storage devices are prohibited; expenses due within 14 calendar days.',
      expected_facts: ['90-day probation', 'USB', '14 calendar days'],
      expected_source_documents: ['Attendance_and_Shift_Handbook.txt', 'Workplace_Code_of_Conduct.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
  ];
  saveEvalDataset(agentId, evalCases);

  // Honest 86.4% final evaluation results (19/22 passed, 3 honest remaining failures)
  const evalResults: EvalCaseResult[] = evalCases.map((tc) => {
    const failedIds = new Set(['EVAL-16', 'EVAL-19', 'EVAL-21']);
    const isFail = failedIds.has(tc.test_id);
    if (!isFail) {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: tc.expected_refusal,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response: tc.expected_refusal
          ? 'I cannot answer this question because the requested topic is not covered in the uploaded Oceanic Shore Operations HR policy documents.'
          : `Based on the policy documents, ${tc.expected_behavior} [${tc.expected_source_documents[0] ?? 'HR_Leave_Policy_2026.txt'}, Section 1]`,
        retrieved_evidence: tc.expected_refusal
          ? []
          : [
              {
                chunk_id: `${tc.expected_source_documents[0] ?? 'HR_Leave_Policy_2026.txt'}::chunk_1`,
                document_name: tc.expected_source_documents[0] ?? 'HR_Leave_Policy_2026.txt',
                page_or_row: 'Section 1',
                source_text: tc.expected_behavior,
                similarity_score: 0.78,
              },
            ],
        scores: {
          grounding: 0.96,
          correctness: 0.94,
          refusal_accuracy: 1.0,
          citation_accuracy: tc.expected_refusal ? 1.0 : 0.92,
          relevance: 0.95,
          overall: 0.95,
        },
        passed: true,
        failure_category: 'none',
        failure_explanation: 'Passed all grounding, factual, refusal, and citation checks.',
        tool_calls_used: tc.test_id === 'EVAL-02' ? ['current_date'] : [],
      };
    }

    if (tc.test_id === 'EVAL-16') {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: tc.expected_refusal,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response:
          'While our company provides 16 weeks of primary caregiver parental leave [HR_Leave_Policy_2026.txt, Section 1], US statutory FMLA typically grants 12 weeks unpaid leave.',
        retrieved_evidence: [
          {
            chunk_id: 'HR_Leave_Policy_2026.txt::chunk_1',
            document_name: 'HR_Leave_Policy_2026.txt',
            page_or_row: 'Section 1',
            source_text: 'Primary caregivers receive 16 weeks of fully paid parental leave...',
            similarity_score: 0.44,
          },
        ],
        scores: {
          grounding: 0.35,
          correctness: 0.2,
          refusal_accuracy: 0.0,
          citation_accuracy: 0.6,
          relevance: 0.7,
          overall: 0.36,
        },
        passed: false,
        failure_category: 'hallucination',
        failure_explanation:
          'Agent answered external US FMLA statutory law from pretraining memory instead of refusing unsupported external law.',
        tool_calls_used: [],
      };
    }

    if (tc.test_id === 'EVAL-19') {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: tc.expected_refusal,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response:
          'Arriving at 09:43 falls within the 15-minute grace period until 09:45, so you will not receive a warning [Attendance_and_Shift_Handbook.txt, Section 1].',
        retrieved_evidence: [
          {
            chunk_id: 'Attendance_and_Shift_Handbook.txt::chunk_1',
            document_name: 'Attendance_and_Shift_Handbook.txt',
            page_or_row: 'Section 1',
            source_text: 'A 15-minute morning grace period (until 09:45) is permitted up to 3 times per calendar month...',
            similarity_score: 0.81,
          },
        ],
        scores: {
          grounding: 0.72,
          correctness: 0.45,
          refusal_accuracy: 1.0,
          citation_accuracy: 0.9,
          relevance: 0.8,
          overall: 0.68,
        },
        passed: false,
        failure_category: 'incomplete_answer',
        failure_explanation:
          'Missed the 3-times-per-month cap on the 09:45 grace period when evaluating 4 arrivals.',
        tool_calls_used: [],
      };
    }

    return {
      test_id: tc.test_id,
      question: tc.question,
      category: tc.category,
      expected_refusal: tc.expected_refusal,
      expected_facts: tc.expected_facts,
      expected_source_documents: tc.expected_source_documents,
      agent_response:
        'Could you please clarify whether you are asking about annual leave carry-over, sick leave, or parental leave? I cannot verify without more specifics.',
      retrieved_evidence: [
        {
          chunk_id: 'HR_Leave_Policy_2026.txt::chunk_1',
          document_name: 'HR_Leave_Policy_2026.txt',
          page_or_row: 'Section 1',
          source_text: 'Unused annual leave up to a maximum of 5 days may be carried over...',
          similarity_score: 0.29,
        },
      ],
      scores: {
        grounding: 0.85,
        correctness: 0.4,
        refusal_accuracy: 0.5,
        citation_accuracy: 0.3,
        relevance: 0.65,
        overall: 0.54,
      },
      passed: false,
      failure_category: 'wrong_refusal',
      failure_explanation:
        'Ambiguous query triggered overly defensive refusal-style prompt instead of summarizing carry-over/expiry defaults with citations.',
      tool_calls_used: [],
    };
  });
  saveEvalResults(agentId, evalResults);

  const optLogs: OptimizationIteration[] = [
    {
      iteration: 1,
      previous_score: 72.7,
      new_score: 81.8,
      failures_identified: 6,
      failure_breakdown: {
        retrieval_miss: 2,
        incorrect_citation: 2,
        incomplete_answer: 1,
        hallucination: 1,
      },
      exact_changes: [
        {
          target: 'retrieval_config',
          parameter_or_section: 'top_k / similarity_threshold',
          previous_value: 'top_k=3, threshold=0.26',
          new_value: 'top_k=5, threshold=0.18',
          reason: 'Cross-document synthesis queries (EVAL-09, EVAL-22) missed secondary document chunks.',
          failure_category: 'retrieval_miss',
        },
        {
          target: 'system_prompt',
          parameter_or_section: 'Optimization Patch #1',
          previous_value: 'Base system instructions',
          new_value: 'Verify all numeric thresholds (days, hours, percentages) in retrieved chunks before answering.',
          reason: 'Improve multi-condition factual completeness.',
          failure_category: 'incomplete_answer',
        },
      ],
      test_cases_addressed: ['EVAL-08', 'EVAL-09', 'EVAL-10', 'EVAL-22'],
      resolved_count: 2,
      notes: 'Resolved 2 cross-document retrieval misses; remaining issues are exclusion rules and boundary math.',
      timestamp: '2026-11-20T09:08:00.000Z',
    },
    {
      iteration: 2,
      previous_score: 81.8,
      new_score: 86.4,
      failures_identified: 4,
      failure_breakdown: {
        incomplete_answer: 2,
        hallucination: 1,
        wrong_refusal: 1,
      },
      exact_changes: [
        {
          target: 'system_prompt',
          parameter_or_section: 'Optimization Patch #2',
          previous_value: 'Patch #1',
          new_value: 'Verify whether a query asks about an excluded item (alcohol in expenses, encashing sick leave) and cite the prohibition.',
          reason: 'Fixed EVAL-20 exclusion check failure.',
          failure_category: 'incomplete_answer',
        },
      ],
      test_cases_addressed: ['EVAL-20'],
      resolved_count: 1,
      notes: 'Resolved exclusion-rule failure (EVAL-20). 3 honest failures remain (external FMLA leak, 3x grace-period count, ambiguous query).',
      timestamp: '2026-11-20T09:11:00.000Z',
    },
  ];
  saveOptimizationLogs(agentId, optLogs);

  const report: QualityReport = {
    agent_id: agentId,
    agent_name: agent.agent_name,
    total_cases: 22,
    correct_answers: 14,
    incorrect_answers: 2,
    correct_refusals: 5,
    incorrect_refusals: 1,
    grounding_score: 91.2,
    correctness_score: 87.9,
    citation_accuracy: 88.6,
    refusal_accuracy: 93.2,
    relevance_score: 92.4,
    overall_score: 86.4,
    iterations: optLogs,
    remaining_failures: evalResults.filter((r) => !r.passed),
    known_limitations: agent.known_limitations,
    recommended_improvements: [
      'Add explicit legal-jurisdiction refusal trigger ("US FMLA", "statutory labor law") to prevent pretraining leakage.',
      'Upload official medical/dental benefits handbook to convert insurance refusal into grounded coverage.',
    ],
    prompt_tournament: [
      {
        candidate_id: 'cand_1',
        label: 'Strict Evidence-First',
        strategy: 'Rigid citation-per-sentence + explicit gap refusal',
        sample_score: 83.3,
        grounding_score: 94.0,
        refusal_accuracy: 100.0,
        selected: true,
      },
      {
        candidate_id: 'cand_2',
        label: 'Structured Analyst',
        strategy: 'Multi-step synthesis checklist',
        sample_score: 79.5,
        grounding_score: 88.0,
        refusal_accuracy: 83.3,
        selected: false,
      },
      {
        candidate_id: 'cand_3',
        label: 'Balanced Concise',
        strategy: 'Short executive policy summary',
        sample_score: 75.0,
        grounding_score: 86.0,
        refusal_accuracy: 83.3,
        selected: false,
      },
    ],
    pipeline_integrity: buildPipelineIntegrityAudit(agent, evalResults),
    budget_metrics: {
      total_llm_calls: 26,
      total_embedding_calls: 4,
      total_latency_ms: 41200,
      estimated_tokens: 34820,
      early_stopped: false,
    },
    generated_at: '2026-11-20T09:12:00.000Z',
  };
  saveQualityReport(agentId, report);

  const baselineComp: HumanBaselineComparison = {
    agent_id: agentId,
    human_baseline_name: 'Hand-Written Human HR Baseline (v1)',
    human_system_prompt:
      'You are an HR assistant for shore staff. Answer questions about leave, attendance, and conduct using the provided HR documents. If something is missing, say you do not know.',
    human_score: 72.7,
    factory_score: 86.4,
    factory_wins: [
      {
        test_id: 'EVAL-09',
        question: 'If a non-exempt coordinator works approved overtime on a public holiday and later takes a 5-day annual leave, what compensation and notice periods apply?',
        category: 'answerable',
        factory_score: 0.95,
        human_score: 0.58,
        reason: 'Factory top_k=5 retrieval and cross-document patch combined Attendance Handbook (2.0x pay) with Leave Policy (15 working days notice); Human baseline missed Leave Policy chunk at top_k=3.',
      },
      {
        test_id: 'EVAL-11',
        question: 'What dental and vision insurance benefits do shore employees receive?',
        category: 'out_of_scope',
        factory_score: 0.96,
        human_score: 0.42,
        reason: 'Groundability Guard explicitly embedded dental/medical insurance refusal; Human baseline speculated about standard corporate dental benefits.',
      },
      {
        test_id: 'EVAL-20',
        question: 'Can I expense a $30 client dinner that included two glasses of wine?',
        category: 'edge_case',
        factory_score: 0.94,
        human_score: 0.61,
        reason: 'Optimization Patch #2 caught the alcohol exclusion rule; Human baseline only checked the $35 cap.',
      },
      {
        test_id: 'EVAL-22',
        question: 'If I am still on my 60-day probation and want to submit a USB-backed expense report from home, which rules apply?',
        category: 'edge_case',
        factory_score: 0.92,
        human_score: 0.55,
        reason: 'Factory synthesized 90-day remote probation + USB ban + 14-day expense deadline across two documents.',
      },
    ],
    human_wins: [
      {
        test_id: 'EVAL-19',
        question: 'I arrived at 09:43 four times this month—do I get a formal HR warning?',
        category: 'edge_case',
        factory_score: 0.68,
        human_score: 0.89,
        reason: 'Concise human prompt counted 4 > 3 monthly grace-period limit cleanly without over-hedging on the 09:45 cutoff.',
      },
    ],
    ties: 17,
    summary:
      'ForgeAI outperformed the hand-written human baseline by +13.7% (4 head-to-head wins vs 1 loss), driven by Groundability Guard refusal boundaries and higher top-k cross-document retrieval.',
    compared_at: '2026-11-20T09:16:00.000Z',
  };
  saveBaselineComparison(agentId, baselineComp);

  const ledger: TrustLedgerEntry[] = [
    {
      id: 'tl_demo_hr_1',
      agent_id: agentId,
      timestamp: '2026-11-20T09:14:00.000Z',
      question: 'How many annual leave days can I carry over and when do they expire?',
      answer:
        'Full-time shore staff may carry over up to 5 unused annual leave days into Q1 of the following year, and those carried-over days must be used by March 31 [HR_Leave_Policy_2026.txt, Section 1].',
      supporting_documents: ['HR_Leave_Policy_2026.txt'],
      supporting_locations: ['HR_Leave_Policy_2026.txt (Section 1)'],
      retrieved_evidence: [
        {
          chunk_id: 'HR_Leave_Policy_2026.txt::chunk_1',
          document_name: 'HR_Leave_Policy_2026.txt',
          page_or_row: 'Section 1',
          source_text:
            'Unused annual leave up to a maximum of 5 days may be carried over into Q1 of the following year (must be used by March 31)...',
          similarity_score: 0.89,
        },
      ],
      evidence_relevance: 0.89,
      grounding_status: 'GREEN',
      unsupported_claims: [],
      tool_executions: [],
      latency_ms: 820,
    },
    {
      id: 'tl_demo_hr_2',
      agent_id: agentId,
      timestamp: '2026-11-20T09:15:00.000Z',
      question: 'Does Oceanic cover root canal dental procedures under employee insurance?',
      answer:
        'I cannot answer this question because employee medical and dental insurance coverage details are not available in the uploaded HR policy documents.',
      supporting_documents: [],
      supporting_locations: [],
      retrieved_evidence: [],
      evidence_relevance: 0.08,
      grounding_status: 'RED',
      unsupported_claims: [],
      tool_executions: [],
      latency_ms: 540,
    },
  ];
  saveTrustLedger(agentId, ledger);
}

async function seedProcurementDemo() {
  const agentId = 'demo_ship_spares_procurement';
  if (loadAgentDefinition(agentId)) return;

  const files = [
    {
      filename: 'marine_spares_catalogue.csv',
      content: `Part_ID,Part_Name,Category,Vessel_Class,Supplier_ID,Supplier_Name,Unit_Price_USD,Min_Order_Qty,Lead_Time_Days,Stock_Status
SP-1001,Main Engine Piston Ring Set,Engine,Panamax Bulk,SUP-01,Baltic Marine Spares,1450,2,14,In Stock
SP-1002,Turbocharger Nozzle Ring,Turbo,VLCC Tanker,SUP-02,Nippon Valve Co,4820,1,28,Low Stock
SP-1003,Cylinder Liner Chrome Plated,Engine,Panamax Bulk,SUP-01,Baltic Marine Spares,6200,1,21,In Stock
SP-1004,Fuel Injection Pump Plunger,Fuel System,Container 8000TEU,SUP-03,Rotterdam Diesel Parts,890,4,10,In Stock
SP-1005,Exhaust Valve Spindle Nimonic,Engine,VLCC Tanker,SUP-02,Nippon Valve Co,2150,2,18,In Stock
SP-1006,Sea Water Cooling Pump Impeller,Pumps,Coastal Tug,SUP-01,Baltic Marine Spares,540,2,7,In Stock
SP-1007,Bilge Separator Filter Element,Filtration,All Vessels,SUP-03,Rotterdam Diesel Parts,165,10,5,In Stock
SP-1008,Lubricating Oil Cooler Gasket Kit,Cooling,Panamax Bulk,SUP-01,Baltic Marine Spares,295,5,9,In Stock
SP-1009,Steering Gear Hydraulic Seal Kit,Hydraulics,VLCC Tanker,SUP-03,Rotterdam Diesel Parts,780,2,12,In Stock
SP-1010,Auxiliary Generator AVR Module,Electrical,Container 8000TEU,SUP-02,Nippon Valve Co,1920,1,16,Backorder
SP-1011,Fresh Water Generator Plate Pack,Desalination,Panamax Bulk,SUP-01,Baltic Marine Spares,3400,1,24,In Stock
SP-1012,Anchor Windlass Brake Lining Set,Deck Machinery,VLCC Tanker,SUP-03,Rotterdam Diesel Parts,1180,2,15,In Stock`,
    },
    {
      filename: 'Supplier_Qualification_Guide.txt',
      content: `[DEMO SAMPLE DATA - Synthesized for ForgeAI Ship-Spares Procurement Demonstration]
MARINE FLEET PROCUREMENT — SUPPLIER QUALIFICATION & TERMS (2026)

1. Approved Suppliers & Payment Terms
- SUP-01 Baltic Marine Spares (Gdansk): Tier-1 Approved. Payment terms Net 45 days. Offers a 6% bulk discount on single purchase orders totaling $5,000 USD or more. Standard warranty: 18 months from vessel delivery.
- SUP-02 Nippon Valve Co (Osaka): Tier-1 Approved for turbocharger and exhaust components. Payment terms Net 30 days. No bulk discount; emergency air-freight surcharge is 14% of order subtotal for lead times under 7 days. Warranty: 24 months.
- SUP-03 Rotterdam Diesel Parts (Rotterdam): Tier-2 Approved. Payment terms Net 30 days. Free port-side delivery within EU/North Sea ports for orders above $2,500 USD; otherwise flat $180 courier fee. Warranty: 12 months.

2. Quality Certifications
All engine, fuel, and steering gear critical spares must carry valid IACS Class Certificate or ISO 9001:2015 traceability documentation prior to dispatch.`,
    },
    {
      filename: 'Procurement_Compliance_SOP.txt',
      content: `[DEMO SAMPLE DATA - Synthesized for ForgeAI Ship-Spares Procurement Demonstration]
MARINE FLEET PROCUREMENT — APPROVAL THRESHOLDS & COMPLIANCE SOP

1. Purchase Order Approval Tiers
- Tier A (Up to $4,999 USD): Fleet Superintendent approval required.
- Tier B ($5,000 to $24,999 USD): Technical Director + Procurement Manager dual sign-off required.
- Tier C ($25,000 USD and above): Competitive 3-bid tender and CFO authorization required.

2. Backorder & Vessel-Off-Hire Escalation
Parts marked "Backorder" in the catalogue cannot be guaranteed for standard lead times and require sourcing an alternate approved supplier or issuing an Emergency Critical Requisition.`,
    },
  ];

  const { docs, chunks } = await indexDemoFiles(agentId, files, 560, 100);
  saveDocumentsMetadata(agentId, docs);
  saveChunks(agentId, chunks);

  const requirements: RequirementsSpec = {
    agent_id: agentId,
    original_brief:
      'Create an assistant that helps marine procurement staff identify spare parts, look up prices and lead times from the catalogue CSV, calculate order totals with discounts, and compare supplier terms.',
    additional_requirements:
      'Must use CSV lookup and calculator accurately and cite exact row numbers and supplier docs.',
    agent_name: 'Marine Spares Procurement Assistant',
    agent_purpose:
      'Assist marine procurement officers with spare part lookup, unit pricing, MOQ, lead times, bulk discount/surcharge calculations, and approval tier compliance.',
    scope: 'Marine spare parts CSV catalogue, approved supplier commercial terms, and PO approval thresholds.',
    target_audience: 'Marine fleet procurement officers and technical superintendents',
    tone: 'Precise, analytical, and procurement-compliant',
    must_answer_topics: [
      'Part IDs, unit prices, MOQ, lead times, and stock status from catalogue CSV',
      'Order total calculations including bulk discounts, air-freight surcharges, and delivery fees',
      'Supplier payment terms, warranties, and certifications',
      'PO approval thresholds and backorder escalation rules',
    ],
    must_refuse_topics: [
      'Live port customs duties or FX exchange rates not in uploaded files',
      'Unapproved external vendors outside SUP-01, SUP-02, SUP-03',
      'Weather forecasts or crew scheduling',
    ],
    supported_topics: [
      'Spare parts catalogue lookup (SP-1001 to SP-1012)',
      'Supplier terms & discounts (Baltic Marine, Nippon Valve, Rotterdam Diesel)',
      'PO approval tiers and compliance documentation',
    ],
    unsupported_topics: ['Live customs tariff rates and real-time foreign exchange rates'],
    required_tools: ['csv_lookup', 'calculator'],
    limitations: [
      'Catalogue covers 12 standardized spare parts (SP-1001 through SP-1012); custom uncatalogued parts are unsupported.',
      'No live FX conversion or port customs tariff data is included.',
    ],
    clarification_history: [
      {
        question: 'Should order calculations include Baltic Marine 6% bulk discounts automatically when subtotal >= $5,000?',
        answer: 'Yes, apply the 6% discount for SUP-01 orders >= $5,000 and state the approval tier.',
      },
    ],
    approved: true,
    created_at: '2026-11-21T10:00:00.000Z',
  };
  saveRequirements(agentId, requirements);

  const groundability: GroundabilityReport = {
    agent_id: agentId,
    overall_groundability_pct: 100,
    checks: [
      {
        topic: 'Part IDs, unit prices, MOQ, lead times, and stock status from catalogue CSV',
        status: 'Fully supported',
        evidence: ['12 rows SP-1001..SP-1012 with Unit_Price_USD, Min_Order_Qty, Lead_Time_Days, Stock_Status.'],
        source_documents: ['marine_spares_catalogue.csv'],
        explanation: 'All structured part fields are present in CSV and queryable via csv_lookup.',
      },
      {
        topic: 'Order total calculations including bulk discounts, air-freight surcharges, and delivery fees',
        status: 'Fully supported',
        evidence: ['SUP-01 6% discount >= $5,000; SUP-02 14% air-freight surcharge; SUP-03 $180 fee <= $2,500.'],
        source_documents: ['Supplier_Qualification_Guide.txt', 'marine_spares_catalogue.csv'],
        explanation: 'Numeric rules and calculator tool allow exact computation.',
      },
      {
        topic: 'Supplier payment terms, warranties, and certifications',
        status: 'Fully supported',
        evidence: ['Net 45/30 terms, 12/18/24 month warranties, IACS / ISO 9001:2015 requirements.'],
        source_documents: ['Supplier_Qualification_Guide.txt'],
        explanation: 'Explicitly covered in Sections 1 and 2.',
      },
      {
        topic: 'PO approval thresholds and backorder escalation rules',
        status: 'Fully supported',
        evidence: ['Tier A <= $4,999, Tier B $5,000-$24,999, Tier C >= $25,000; Backorder escalation SOP.'],
        source_documents: ['Procurement_Compliance_SOP.txt'],
        explanation: 'Explicitly covered in Procurement Compliance SOP.',
      },
    ],
    flagged_gaps: [
      'Custom uncatalogued parts, live FX rates, and port customs duties are absent from documents and must be refused.',
    ],
    warnings: [],
    generated_at: '2026-11-21T10:02:00.000Z',
  };
  saveGroundability(agentId, groundability);

  const agent: AgentDefinition = {
    id: agentId,
    agent_name: 'Marine Spares Procurement Assistant',
    description:
      'Identifies vessel spare parts from the catalogue CSV, calculates order totals with supplier terms using deterministic tools, and checks PO approval compliance.',
    system_prompt: `You are the Marine Spares Procurement Assistant.
Always verify part numbers, prices, MOQ, stock status, and supplier names using the csv_lookup tool and retrieved catalogue chunks, and use the calculator tool for all order totals, discounts, and surcharges.

Mandatory Rules:
1. Cite exact [DocumentName, Row N / Section N] for every part price, lead time, and commercial rule.
2. Check Min_Order_Qty (MOQ) before confirming order quantities.
3. Combine Supplier_Qualification_Guide.txt commercial rules with Procurement_Compliance_SOP.txt approval tiers when quoting orders.
4. Refuse requests for live port weather, FX rates, customs tariffs, or parts not in the uploaded catalogue.

[Targeted Optimization Patch #1]
Whenever calculating an order total for SUP-01 (Baltic Marine Spares) >= $5,000, apply the 6% bulk discount first using the calculator tool and evaluate the PO approval tier on the discounted net total.

[Targeted Optimization Patch #2]
Explicitly flag any part whose Stock_Status is "Backorder" or "Low Stock" and reference the Backorder Escalation rule in Procurement_Compliance_SOP.txt.`,
    target_audience: 'Marine fleet procurement officers and technical superintendents',
    tone: 'Precise, analytical, and procurement-compliant',
    supported_topics: requirements.supported_topics,
    refusal_rules: [
      'Refuse live customs tariff, FX exchange rate, or uncatalogued OEM part pricing queries.',
      'Refuse weather or unrelated operational inquiries.',
    ],
    retrieval_config: {
      chunk_size: 560,
      chunk_overlap: 100,
      top_k: 6,
      similarity_threshold: 0.16,
    },
    selected_tools: ['csv_lookup', 'calculator'],
    output_contract:
      'Structured procurement summary listing Part_ID, Supplier, MOQ, Lead Time, calculated net total, PO approval tier, and [Document, Row/Section] citations.',
    source_citation_requirements:
      'Cite CSV rows as [marine_spares_catalogue.csv, Row N] and policy text as [DocumentName, Section N].',
    known_limitations: requirements.limitations,
    version: 3,
    status: 'ready',
    is_demo: true,
    created_at: '2026-11-21T10:05:00.000Z',
    updated_at: '2026-11-21T10:15:00.000Z',
  };
  saveAgentDefinition(agent);

  const evalCases: EvalTestCase[] = [
    {
      test_id: 'EVAL-01',
      question: 'What is the unit price, MOQ, and lead time for SP-1001 Main Engine Piston Ring Set?',
      category: 'answerable',
      subcategory: 'csv_row_lookup',
      expected_behavior: '$1,450 USD, MOQ 2, 14 days lead time from Baltic Marine Spares.',
      expected_facts: ['1450', '2', '14', 'Baltic Marine Spares'],
      expected_source_documents: ['marine_spares_catalogue.csv'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-02',
      question: 'Which parts are supplied by Nippon Valve Co and what are their stock statuses?',
      category: 'answerable',
      subcategory: 'csv_filter_lookup',
      expected_behavior: 'SP-1002 (Low Stock), SP-1005 (In Stock), SP-1010 (Backorder).',
      expected_facts: ['SP-1002', 'SP-1005', 'SP-1010', 'Backorder'],
      expected_source_documents: ['marine_spares_catalogue.csv'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-03',
      question: 'What are the payment terms and warranty period for Rotterdam Diesel Parts?',
      category: 'answerable',
      subcategory: 'supplier_terms',
      expected_behavior: 'Tier-2 Approved, Net 30 days, 12 months warranty.',
      expected_facts: ['Net 30', '12 months', 'Tier-2'],
      expected_source_documents: ['Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-04',
      question: 'What approval is needed for a $12,000 spare parts purchase order?',
      category: 'answerable',
      subcategory: 'compliance_tier',
      expected_behavior: 'Tier B ($5,000-$24,999): Technical Director + Procurement Manager dual sign-off.',
      expected_facts: ['Tier B', 'Technical Director', 'Procurement Manager'],
      expected_source_documents: ['Procurement_Compliance_SOP.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-05',
      question: 'Calculate the total cost of ordering 4 sets of SP-1001 from Baltic Marine Spares after any applicable bulk discount, and state the PO approval tier.',
      category: 'answerable',
      subcategory: 'cross_document_calculation',
      expected_behavior: '4 * 1450 = $5,800; 6% discount = $5,452; Tier B dual sign-off.',
      expected_facts: ['5800', '5452', '6%', 'Tier B'],
      expected_source_documents: ['marine_spares_catalogue.csv', 'Supplier_Qualification_Guide.txt', 'Procurement_Compliance_SOP.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-06',
      question: 'What is the emergency air-freight surcharge for Nippon Valve Co and when does it apply?',
      category: 'answerable',
      subcategory: 'supplier_terms',
      expected_behavior: '14% of order subtotal for lead times under 7 days.',
      expected_facts: ['14%', '7 days'],
      expected_source_documents: ['Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-07',
      question: 'Calculate the delivered order total to a North Sea port for 4 units of SP-1004 Fuel Injection Pump Plunger.',
      category: 'answerable',
      subcategory: 'cross_document_calculation',
      expected_behavior: '4 * 890 = $3,560 (> $2,500 so free EU/North Sea delivery from SUP-03).',
      expected_facts: ['3560', 'Free'],
      expected_source_documents: ['marine_spares_catalogue.csv', 'Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-08',
      question: 'Which vessel class uses SP-1006 Sea Water Cooling Pump Impeller and what is its shortest lead time among Baltic Marine parts?',
      category: 'answerable',
      subcategory: 'csv_lookup',
      expected_behavior: 'Coastal Tug; 7 days lead time.',
      expected_facts: ['Coastal Tug', '7'],
      expected_source_documents: ['marine_spares_catalogue.csv'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-09',
      question: 'What certifications are required for steering gear hydraulic seal kits (SP-1009)?',
      category: 'answerable',
      subcategory: 'cross_document_synthesis',
      expected_behavior: 'IACS Class Certificate or ISO 9001:2015 traceability documentation.',
      expected_facts: ['IACS', 'ISO 9001:2015'],
      expected_source_documents: ['marine_spares_catalogue.csv', 'Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-10',
      question: 'What does a $28,000 purchase order require under the Compliance SOP?',
      category: 'answerable',
      subcategory: 'compliance_tier',
      expected_behavior: 'Tier C: Competitive 3-bid tender and CFO authorization.',
      expected_facts: ['Tier C', '3-bid tender', 'CFO'],
      expected_source_documents: ['Procurement_Compliance_SOP.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-11',
      question: 'What is the current EUR/USD exchange rate for paying Rotterdam Diesel Parts?',
      category: 'out_of_scope',
      subcategory: 'unsupported_fx',
      expected_behavior: 'Refuse because live FX rates are not in the uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-12',
      question: 'What customs import duty percentage applies when shipping SP-1002 into Singapore?',
      category: 'out_of_scope',
      subcategory: 'unsupported_customs',
      expected_behavior: 'Refuse because customs duties are not in uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-13',
      question: 'What is the weather in Rotterdam port right now?',
      category: 'out_of_scope',
      subcategory: 'unrelated_weather',
      expected_behavior: 'Refuse because weather is outside procurement scope and no weather tool is attached.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-14',
      question: 'Quote me the unit price for SP-9999 Main Rudder Bearing from Hyundai Heavy Industries.',
      category: 'out_of_scope',
      subcategory: 'uncatalogued_part',
      expected_behavior: 'Refuse because SP-9999 and Hyundai Heavy Industries are not in the uploaded catalogue.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-15',
      question: 'How many annual leave days does a procurement manager get?',
      category: 'out_of_scope',
      subcategory: 'cross_domain_leak',
      expected_behavior: 'Refuse HR leave question as out of scope for procurement documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-16',
      question: 'Recommend an alternative Korean spare-parts vendor for VLCC main engines.',
      category: 'out_of_scope',
      subcategory: 'external_knowledge_coaxing',
      expected_behavior: 'Refuse recommending external unapproved suppliers not in uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-17',
      question: 'I want to order 5 units of SP-1007 Bilge Separator Filter Element—what is the subtotal and is the order valid?',
      category: 'edge_case',
      subcategory: 'moq_violation',
      expected_behavior: 'Flag that MOQ for SP-1007 is 10 units, so 5 units violates minimum order quantity.',
      expected_facts: ['10', 'Min_Order_Qty'],
      expected_source_documents: ['marine_spares_catalogue.csv'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-18',
      question: 'Can we order SP-1010 Auxiliary Generator AVR Module with guaranteed 16-day delivery?',
      category: 'edge_case',
      subcategory: 'backorder_constraint',
      expected_behavior: 'SP-1010 is Backorder; standard lead time cannot be guaranteed and requires alternate supplier or Emergency Critical Requisition.',
      expected_facts: ['Backorder', 'Emergency Critical Requisition'],
      expected_source_documents: ['marine_spares_catalogue.csv', 'Procurement_Compliance_SOP.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-19',
      question: 'What is the total for 2 units of SP-1009 delivered to Rotterdam, including any delivery fee?',
      category: 'edge_case',
      subcategory: 'fee_threshold',
      expected_behavior: '2 * 780 = $1,560 (< $2,500), so $180 courier fee applies -> $1,740.',
      expected_facts: ['1560', '180', '1740'],
      expected_source_documents: ['marine_spares_catalogue.csv', 'Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-20',
      question: 'Apply the 6% bulk discount to 1 unit of SP-1002 Turbocharger Nozzle Ring ($4,820) and check if it drops below $4,600.',
      category: 'edge_case',
      subcategory: 'false_premise',
      expected_behavior: 'Correct premise: SP-1002 is supplied by Nippon Valve Co (SUP-02), which offers NO bulk discount (6% discount is only for SUP-01 Baltic Marine >= $5,000).',
      expected_facts: ['Nippon Valve Co', 'No bulk discount'],
      expected_source_documents: ['marine_spares_catalogue.csv', 'Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-21',
      question: 'Check the valve.',
      category: 'edge_case',
      subcategory: 'ambiguous_query',
      expected_behavior: 'Identify SP-1005 Exhaust Valve Spindle Nimonic ($2,150) or ask for part clarification.',
      expected_facts: ['SP-1005'],
      expected_source_documents: ['marine_spares_catalogue.csv'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-22',
      question: 'Compare warranty length and payment terms between SUP-01 and SUP-02 for VLCC vs Panamax engine parts.',
      category: 'edge_case',
      subcategory: 'cross_document_comparison',
      expected_behavior: 'SUP-01: Net 45, 18 months warranty; SUP-02: Net 30, 24 months warranty.',
      expected_facts: ['Net 45', '18 months', 'Net 30', '24 months'],
      expected_source_documents: ['Supplier_Qualification_Guide.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
  ];
  saveEvalDataset(agentId, evalCases);

  const evalResults: EvalCaseResult[] = evalCases.map((tc) => {
    const failedIds = new Set(['EVAL-16', 'EVAL-17', 'EVAL-19', 'EVAL-21']);
    const isFail = failedIds.has(tc.test_id);
    if (!isFail) {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: tc.expected_refusal,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response: tc.expected_refusal
          ? 'I cannot answer this request because it falls outside the uploaded marine spares catalogue and supplier compliance documents.'
          : `${tc.expected_behavior} [${tc.expected_source_documents[0] ?? 'marine_spares_catalogue.csv'}, Row 1]`,
        retrieved_evidence: tc.expected_refusal
          ? []
          : [
              {
                chunk_id: `${tc.expected_source_documents[0] ?? 'marine_spares_catalogue.csv'}::chunk_1`,
                document_name: tc.expected_source_documents[0] ?? 'marine_spares_catalogue.csv',
                page_or_row: 'Row 1',
                source_text: tc.expected_behavior,
                similarity_score: 0.84,
              },
            ],
        scores: {
          grounding: 0.95,
          correctness: 0.93,
          refusal_accuracy: 1.0,
          citation_accuracy: tc.expected_refusal ? 1.0 : 0.91,
          relevance: 0.94,
          overall: 0.94,
        },
        passed: true,
        failure_category: 'none',
        failure_explanation: 'Passed all grounding, tool execution, factual, and citation checks.',
        tool_calls_used:
          tc.test_id === 'EVAL-05' || tc.test_id === 'EVAL-07'
            ? ['csv_lookup', 'calculator']
            : tc.expected_source_documents.includes('marine_spares_catalogue.csv')
            ? ['csv_lookup']
            : [],
      };
    }

    if (tc.test_id === 'EVAL-16') {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: true,
        expected_facts: [],
        expected_source_documents: [],
        agent_response:
          'You could consider Hyundai Marine Services or STX Engine in South Korea, though our approved guide only lists Nippon Valve Co.',
        retrieved_evidence: [],
        scores: {
          grounding: 0.25,
          correctness: 0.2,
          refusal_accuracy: 0.0,
          citation_accuracy: 0.5,
          relevance: 0.7,
          overall: 0.28,
        },
        passed: false,
        failure_category: 'hallucination',
        failure_explanation:
          'Named external unapproved Korean vendors from general knowledge instead of refusing.',
        tool_calls_used: [],
      };
    }

    if (tc.test_id === 'EVAL-17') {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: false,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response:
          '5 units of SP-1007 cost $825 USD (5 * $165) [marine_spares_catalogue.csv, Row 7].',
        retrieved_evidence: [
          {
            chunk_id: 'marine_spares_catalogue.csv::chunk_2',
            document_name: 'marine_spares_catalogue.csv',
            page_or_row: 'Row 7',
            source_text: 'SP-1007, Bilge Separator Filter Element, Unit_Price_USD: 165, Min_Order_Qty: 10',
            similarity_score: 0.87,
          },
        ],
        scores: {
          grounding: 0.85,
          correctness: 0.5,
          refusal_accuracy: 1.0,
          citation_accuracy: 0.9,
          relevance: 0.85,
          overall: 0.67,
        },
        passed: false,
        failure_category: 'incomplete_answer',
        failure_explanation:
          'Calculated subtotal accurately but failed to warn that quantity 5 is below Min_Order_Qty (10).',
        tool_calls_used: ['csv_lookup', 'calculator'],
      };
    }

    if (tc.test_id === 'EVAL-19') {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: false,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response:
          '2 units of SP-1009 cost $1,560 USD [marine_spares_catalogue.csv, Row 9]. Free EU delivery applies for SUP-03.',
        retrieved_evidence: [
          {
            chunk_id: 'marine_spares_catalogue.csv::chunk_3',
            document_name: 'marine_spares_catalogue.csv',
            page_or_row: 'Row 9',
            source_text: 'SP-1009, Steering Gear Hydraulic Seal Kit, SUP-03, Unit_Price_USD: 780',
            similarity_score: 0.86,
          },
        ],
        scores: {
          grounding: 0.6,
          correctness: 0.45,
          refusal_accuracy: 1.0,
          citation_accuracy: 0.75,
          relevance: 0.8,
          overall: 0.62,
        },
        passed: false,
        failure_category: 'retrieval_miss',
        failure_explanation:
          'Missed the $2,500 free-delivery threshold and $180 courier fee chunk from Supplier_Qualification_Guide.txt.',
        tool_calls_used: ['csv_lookup', 'calculator'],
      };
    }

    return {
      test_id: tc.test_id,
      question: tc.question,
      category: tc.category,
      expected_refusal: false,
      expected_facts: tc.expected_facts,
      expected_source_documents: tc.expected_source_documents,
      agent_response:
        'Please specify the exact Part_ID or vessel system you are referring to; multiple valve-related parts exist.',
      retrieved_evidence: [],
      scores: {
        grounding: 0.8,
        correctness: 0.4,
        refusal_accuracy: 0.6,
        citation_accuracy: 0.2,
        relevance: 0.7,
        overall: 0.54,
      },
      passed: false,
      failure_category: 'incorrect_citation',
      failure_explanation:
        'Asked for clarification without citing candidate SP-1005 or Nippon Valve Co from the catalogue.',
      tool_calls_used: [],
    };
  });
  saveEvalResults(agentId, evalResults);

  const optLogs: OptimizationIteration[] = [
    {
      iteration: 1,
      previous_score: 68.2,
      new_score: 77.3,
      failures_identified: 7,
      failure_breakdown: {
        retrieval_miss: 3,
        prompt_defect: 2,
        incomplete_answer: 1,
        hallucination: 1,
      },
      exact_changes: [
        {
          target: 'retrieval_config',
          parameter_or_section: 'top_k / similarity_threshold',
          previous_value: 'top_k=4, threshold=0.25',
          new_value: 'top_k=6, threshold=0.16',
          reason: 'CSV + supplier text cross-referencing required higher top_k.',
          failure_category: 'retrieval_miss',
        },
        {
          target: 'system_prompt',
          parameter_or_section: 'Optimization Patch #1',
          previous_value: 'Base instructions',
          new_value: 'Apply SUP-01 6% discount first using calculator and evaluate PO approval tier on discounted net total.',
          reason: 'Resolved discount/tier ordering error on EVAL-05.',
          failure_category: 'prompt_defect',
        },
      ],
      test_cases_addressed: ['EVAL-05', 'EVAL-09', 'EVAL-22'],
      resolved_count: 2,
      notes: 'Increased cross-document accuracy from 68.2% to 77.3%.',
      timestamp: '2026-11-21T10:10:00.000Z',
    },
    {
      iteration: 2,
      previous_score: 77.3,
      new_score: 81.8,
      failures_identified: 5,
      failure_breakdown: {
        incomplete_answer: 2,
        retrieval_miss: 1,
        hallucination: 1,
        incorrect_citation: 1,
      },
      exact_changes: [
        {
          target: 'system_prompt',
          parameter_or_section: 'Optimization Patch #2',
          previous_value: 'Patch #1',
          new_value: 'Flag any part whose Stock_Status is Backorder or Low Stock and reference Escalation SOP.',
          reason: 'Resolved EVAL-18 backorder escalation check.',
          failure_category: 'incomplete_answer',
        },
      ],
      test_cases_addressed: ['EVAL-18'],
      resolved_count: 1,
      notes: 'Resolved EVAL-18. 4 failures remain (MOQ check on SP-1007, $2,500 shipping threshold, Korean vendor leak, ambiguous valve query).',
      timestamp: '2026-11-21T10:14:00.000Z',
    },
  ];
  saveOptimizationLogs(agentId, optLogs);

  const report: QualityReport = {
    agent_id: agentId,
    agent_name: agent.agent_name,
    total_cases: 22,
    correct_answers: 13,
    incorrect_answers: 3,
    correct_refusals: 5,
    incorrect_refusals: 1,
    grounding_score: 86.8,
    correctness_score: 84.1,
    citation_accuracy: 85.4,
    refusal_accuracy: 91.5,
    relevance_score: 90.2,
    overall_score: 81.8,
    iterations: optLogs,
    remaining_failures: evalResults.filter((r) => !r.passed),
    known_limitations: agent.known_limitations,
    recommended_improvements: [
      'Enforce deterministic MOQ validation in csv_lookup return payload whenever requested quantity < Min_Order_Qty.',
      'Add explicit supplier whitelist check ("Only SUP-01, SUP-02, SUP-03 are approved") to block external vendor suggestions.',
    ],
    pipeline_integrity: buildPipelineIntegrityAudit(agent, evalResults),
    budget_metrics: {
      total_llm_calls: 29,
      total_embedding_calls: 3,
      total_latency_ms: 46500,
      estimated_tokens: 39140,
      early_stopped: false,
    },
    generated_at: '2026-11-21T10:15:00.000Z',
  };
  saveQualityReport(agentId, report);

  const ledger: TrustLedgerEntry[] = [
    {
      id: 'tl_demo_proc_1',
      agent_id: agentId,
      timestamp: '2026-11-21T10:18:00.000Z',
      question: 'Calculate the total cost for 4 sets of SP-1001 from Baltic Marine Spares and what approval is needed.',
      answer:
        '4 sets of SP-1001 at $1,450 each equal a $5,800 subtotal [marine_spares_catalogue.csv, Row 1]. Because the order exceeds $5,000 with SUP-01 Baltic Marine Spares, a 6% bulk discount applies, bringing the net total to $5,452 USD [Supplier_Qualification_Guide.txt, Section 1]. This falls under Tier B ($5,000–$24,999), requiring Technical Director and Procurement Manager dual sign-off [Procurement_Compliance_SOP.txt, Section 1].',
      supporting_documents: [
        'marine_spares_catalogue.csv',
        'Supplier_Qualification_Guide.txt',
        'Procurement_Compliance_SOP.txt',
      ],
      supporting_locations: [
        'marine_spares_catalogue.csv (Row 1)',
        'Supplier_Qualification_Guide.txt (Section 1)',
        'Procurement_Compliance_SOP.txt (Section 1)',
      ],
      retrieved_evidence: [
        {
          chunk_id: 'marine_spares_catalogue.csv::chunk_1',
          document_name: 'marine_spares_catalogue.csv',
          page_or_row: 'Row 1-4',
          source_text: 'Row 1: Part_ID: SP-1001 | Part_Name: Main Engine Piston Ring Set | Supplier_ID: SUP-01 | Unit_Price_USD: 1450 | Min_Order_Qty: 2',
          similarity_score: 0.91,
        },
      ],
      evidence_relevance: 0.91,
      grounding_status: 'GREEN',
      unsupported_claims: [],
      tool_executions: [
        {
          tool: 'csv_lookup',
          arguments: { query: 'SP-1001' },
          result_summary: 'Matched Row 1: SP-1001, Unit_Price_USD=1450, MOQ=2, SUP-01',
        },
        {
          tool: 'calculator',
          arguments: { expression: '(1450 * 4) * 0.94' },
          result_summary: '5452',
        },
      ],
      latency_ms: 1120,
    },
  ];
  saveTrustLedger(agentId, ledger);
}

async function seedVoyageComplianceDemo() {
  const agentId = 'demo_voyage_weather_routing';
  if (loadAgentDefinition(agentId)) return;

  const files = [
    {
      filename: 'vessel_voyage_log.csv',
      content: `Voyage_ID,Vessel_Name,Origin_Port,Destination_Port,Route_Scope,Fuel_Type,Fuel_Consumed_MT,CO2_Factor,Status
VY-401,MV Nordic Horizon,Rotterdam,Hamburg,Intra-EU,VLSFO,142,3.151,Completed
VY-402,MV Atlantic Crest,Singapore,Rotterdam,Extra-EU-Incoming,MGO,610,3.206,In Transit
VY-403,MV Baltic Meridian,Gdansk,Antwerp,Intra-EU,LNG,118,2.750,Scheduled
VY-404,MV Pacific Vanguard,Busan,Tokyo,Non-EU,VLSFO,185,3.151,Completed`,
    },
    {
      filename: 'EU_ETS_Maritime_Compliance_Brief.txt',
      content: `[DEMO SAMPLE DATA - Original Maritime Emissions & Weather Dispatch Domain]
MARITIME FLEET DISPATCH — EU ETS & PORT WEATHER OPERATING RULES (2026)

1. EU ETS Surrender Scope & Phase-In
- Intra-EU voyages (both origin and destination inside EU/EEA ports) incur 100% EU ETS emission liability.
- Extra-EU voyages (one EU/EEA port and one non-EU port) incur 50% EU ETS emission liability.
- Purely Non-EU voyages (neither port in EU/EEA) incur 0% EU ETS liability.
- For 2026 compliance reporting, shipping companies must surrender allowances for 100% of verified scoped emissions (2024 was 40%, 2025 was 70%, 2026 is 100%).
- CO2 Emissions (MT) = Fuel_Consumed_MT * CO2_Factor. Estimated carbon cost = Scoped_CO2_MT * 78 EUR/MT reference allowance price.

2. Annual Verification & Surrender Deadlines
- Verified fleet emissions report must be submitted to the Administering Authority by March 31 each year.
- EU Allowances (EUAs) must be surrendered in the Union Registry by September 30 each year.

3. Port Weather Dispatch Thresholds
- Before confirming berth arrival or bunkering operations, dispatchers must verify live wind speed at the destination port via Open-Meteo.
- If destination wind_speed_10m exceeds 38 km/h, flag "High Wind Bunkering Hold" and require Master confirmation.`,
    },
  ];

  const { docs, chunks } = await indexDemoFiles(agentId, files, 600, 100);
  saveDocumentsMetadata(agentId, docs);
  saveChunks(agentId, chunks);

  const requirements: RequirementsSpec = {
    agent_id: agentId,
    original_brief:
      'Build a Voyage Weather & EU ETS Compliance Advisor for marine dispatchers that checks live destination port weather, looks up voyage fuel logs from CSV, calculates CO2 and EUR allowance costs, checks reporting deadlines against today’s date, and answers Panama Canal toll fees if asked.',
    additional_requirements:
      'Only answer from uploaded logs and EU ETS rules; refuse Panama Canal tolls or missing tariff schedules.',
    agent_name: 'Voyage Weather & EU ETS Compliance Advisor',
    agent_purpose:
      'Support fleet dispatchers with EU ETS voyage carbon calculations, live Open-Meteo port weather wind checks, and compliance deadline tracking.',
    scope: 'Voyage fuel CSV logs, EU ETS 2026 maritime rules, Open-Meteo port wind checks, and reporting deadlines.',
    target_audience: 'Marine fleet dispatchers and environmental compliance officers',
    tone: 'Operational, quantitative, and audit-ready',
    must_answer_topics: [
      'Voyage fuel consumption and CO2 factor lookups from CSV',
      'Intra-EU (100%), Extra-EU (50%), and Non-EU (0%) EU ETS cost calculations',
      'March 31 verification and September 30 EUA surrender deadlines relative to current date',
      'Live port weather wind-speed bunkering hold checks via Open-Meteo',
      'Panama Canal toll fees and transit tariffs',
    ],
    must_refuse_topics: [
      'Panama Canal toll fees and transit tariffs (not in uploaded documents)',
      'Shore HR leave policies or spare-parts pricing',
    ],
    supported_topics: [
      'Voyage CSV fuel/CO2 lookups (VY-401 to VY-404)',
      '2026 EU ETS phase-in and EUR 78/MT carbon cost math',
      'Live port weather wind-speed checks via Open-Meteo',
      'Compliance deadlines vs current date',
    ],
    unsupported_topics: ['Panama Canal toll fees and transit tariffs'],
    required_tools: ['csv_lookup', 'calculator', 'public_weather', 'current_date'],
    limitations: [
      'Panama Canal toll fees and Suez Canal transit tariffs are not present in the uploaded documents and will be refused.',
      'Carbon price is fixed at the 78 EUR/MT reference value stated in the compliance brief, not a live exchange feed.',
    ],
    clarification_history: [
      {
        question: 'Should live port weather be checked dynamically before advising on bunkering holds?',
        answer: 'Yes, query Open-Meteo for the destination port and compare wind_speed_10m against the 38 km/h threshold.',
      },
    ],
    approved: true,
    created_at: '2026-11-22T08:30:00.000Z',
  };
  saveRequirements(agentId, requirements);

  const groundability: GroundabilityReport = {
    agent_id: agentId,
    overall_groundability_pct: 80,
    checks: [
      {
        topic: 'Voyage fuel consumption and CO2 factor lookups from CSV',
        status: 'Fully supported',
        evidence: ['VY-401..VY-404 in vessel_voyage_log.csv with Fuel_Consumed_MT and CO2_Factor.'],
        source_documents: ['vessel_voyage_log.csv'],
        explanation: 'All voyage metrics are structured in CSV.',
      },
      {
        topic: 'Intra-EU (100%), Extra-EU (50%), and Non-EU (0%) EU ETS cost calculations',
        status: 'Fully supported',
        evidence: ['100% Intra-EU, 50% Extra-EU, 0% Non-EU; 2026 phase-in 100%; 78 EUR/MT reference price.'],
        source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
        explanation: 'All formulas and reference prices are specified.',
      },
      {
        topic: 'March 31 verification and September 30 EUA surrender deadlines relative to current date',
        status: 'Fully supported',
        evidence: ['March 31 verification deadline; September 30 Union Registry surrender deadline.'],
        source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
        explanation: 'Deadlines supported; current_date tool enables relative checks.',
      },
      {
        topic: 'Live port weather wind-speed bunkering hold checks via Open-Meteo',
        status: 'Fully supported',
        evidence: ['Wind speed > 38 km/h triggers High Wind Bunkering Hold via Open-Meteo.'],
        source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
        explanation: 'Explicitly authorized for public_weather tool.',
      },
      {
        topic: 'Panama Canal toll fees and transit tariffs',
        status: 'Not supported',
        evidence: [],
        source_documents: [],
        explanation: 'Zero Panama Canal tariff tables or transit rules exist in uploaded documents. Flagged as refusal gap.',
      },
    ],
    flagged_gaps: [
      'Panama Canal toll fees are not available in the uploaded documents. The generated agent will refuse Panama Canal tariff queries.',
    ],
    warnings: ['1 of 5 requested topics ("Panama Canal toll fees") has zero document support.'],
    generated_at: '2026-11-22T08:32:00.000Z',
  };
  saveGroundability(agentId, groundability);

  const agent: AgentDefinition = {
    id: agentId,
    agent_name: 'Voyage Weather & EU ETS Compliance Advisor',
    description:
      'Combines vessel voyage CSV logs, 2026 EU ETS emission rules, live Open-Meteo port weather checks, and current date deadline tracking.',
    system_prompt: `You are the Voyage Weather & EU ETS Compliance Advisor for Marine Fleet Dispatch.
Use csv_lookup for voyage records, calculator for CO2 and EUR allowance math, public_weather for live port wind checks, and current_date for deadline checks.

Mandatory Rules:
1. Cite exact [DocumentName, Row N / Section N] for every voyage metric and regulatory threshold.
2. When calculating EU ETS cost: first compute CO2 = Fuel_Consumed_MT * CO2_Factor, apply route scope (100% Intra-EU, 50% Extra-EU, 0% Non-EU), then multiply by 78 EUR/MT using calculator.
3. Refuse questions about Panama Canal tolls, Suez tariffs, or live EUA market spot prices not in the documents.

[Targeted Optimization Patch #1]
Always check wind_speed_10m against the 38 km/h bunkering threshold when reporting live weather from public_weather.`,
    target_audience: 'Marine fleet dispatchers and environmental compliance officers',
    tone: 'Operational, quantitative, and audit-ready',
    supported_topics: requirements.supported_topics,
    refusal_rules: [
      'Refuse Panama Canal toll fees, Suez transit tariffs, and live carbon exchange spot prices.',
      'Refuse HR or spare-parts queries outside maritime dispatch documents.',
    ],
    retrieval_config: {
      chunk_size: 600,
      chunk_overlap: 100,
      top_k: 5,
      similarity_threshold: 0.18,
    },
    selected_tools: ['csv_lookup', 'calculator', 'public_weather', 'current_date'],
    output_contract:
      'Concise dispatch readout with tool outputs, computed CO2/EUR figures, wind-hold status, and [Document, Row/Section] citations.',
    source_citation_requirements:
      'Cite CSV rows as [vessel_voyage_log.csv, Row N] and rules as [EU_ETS_Maritime_Compliance_Brief.txt, Section N].',
    known_limitations: requirements.limitations,
    version: 2,
    status: 'ready',
    is_demo: true,
    created_at: '2026-11-22T08:35:00.000Z',
    updated_at: '2026-11-22T08:42:00.000Z',
  };
  saveAgentDefinition(agent);

  const evalCases: EvalTestCase[] = [
    {
      test_id: 'EVAL-01',
      question: 'What is the fuel type and fuel consumed for voyage VY-401?',
      category: 'answerable',
      subcategory: 'csv_row_lookup',
      expected_behavior: 'MV Nordic Horizon, Rotterdam to Hamburg, VLSFO, 142 MT.',
      expected_facts: ['VLSFO', '142', 'Rotterdam', 'Hamburg'],
      expected_source_documents: ['vessel_voyage_log.csv'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-02',
      question: 'What EU ETS route scope percentage applies to Extra-EU voyages in 2026?',
      category: 'answerable',
      subcategory: 'policy_lookup',
      expected_behavior: '50% emission liability for Extra-EU voyages with 100% 2026 phase-in.',
      expected_facts: ['50%', '100%'],
      expected_source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-03',
      question: 'Calculate the total CO2 emissions and EU ETS EUR cost for VY-401.',
      category: 'answerable',
      subcategory: 'cross_document_calculation',
      expected_behavior: '142 * 3.151 = 447.442 MT CO2 * 100% * 78 EUR = 34,900.48 EUR.',
      expected_facts: ['447.442', '34900'],
      expected_source_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-04',
      question: 'What are the annual verification and EUA surrender deadlines?',
      category: 'answerable',
      subcategory: 'policy_lookup',
      expected_behavior: 'March 31 verification report; September 30 EUA surrender.',
      expected_facts: ['March 31', 'September 30'],
      expected_source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-05',
      question: 'What wind speed threshold triggers a High Wind Bunkering Hold?',
      category: 'answerable',
      subcategory: 'policy_lookup',
      expected_behavior: 'Wind speed exceeding 38 km/h at the destination port.',
      expected_facts: ['38 km/h'],
      expected_source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-06',
      question: 'What is the EU ETS cost for voyage VY-404 from Busan to Tokyo?',
      category: 'answerable',
      subcategory: 'cross_document_calculation',
      expected_behavior: 'Non-EU voyage incurs 0% EU ETS liability (0 EUR).',
      expected_facts: ['0%', 'Non-EU'],
      expected_source_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-07',
      question: 'What is the Panama Canal transit toll for MV Atlantic Crest?',
      category: 'out_of_scope',
      subcategory: 'unsupported_flagged_gap',
      expected_behavior: 'Refuse because Panama Canal toll fees are not in uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-08',
      question: 'What is the live ICE Futures EUA carbon spot price today?',
      category: 'out_of_scope',
      subcategory: 'unsupported_market_price',
      expected_behavior: 'Refuse live exchange price; note only 78 EUR/MT reference price is documented.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-09',
      question: 'Calculate the scoped EU ETS CO2 for VY-402 (Singapore to Rotterdam).',
      category: 'edge_case',
      subcategory: 'extra_eu_half_scope',
      expected_behavior: '610 * 3.206 = 1955.66 MT total CO2; Extra-EU 50% scope = 977.83 MT.',
      expected_facts: ['1955.66', '977.83', '50%'],
      expected_source_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-10',
      question: 'Check live wind speed in Rotterdam and advise if bunkering hold applies.',
      category: 'edge_case',
      subcategory: 'live_tool_threshold',
      expected_behavior: 'Call public_weather for Rotterdam and compare wind_speed_10m against 38 km/h.',
      expected_facts: ['38 km/h'],
      expected_source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
  ];

  // Expand to 20 validated cases so every demo satisfies >=20 eval cases
  const extraCases: EvalTestCase[] = [
    {
      test_id: 'EVAL-11',
      question: 'Which fuel and CO2 factor are used on MV Baltic Meridian (VY-403)?',
      category: 'answerable',
      subcategory: 'csv_row_lookup',
      expected_behavior: 'LNG with CO2 factor 2.750.',
      expected_facts: ['LNG', '2.750'],
      expected_source_documents: ['vessel_voyage_log.csv'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-12',
      question: 'What was the EU ETS phase-in percentage in 2024 vs 2025 vs 2026?',
      category: 'answerable',
      subcategory: 'policy_lookup',
      expected_behavior: '40% in 2024, 70% in 2025, 100% in 2026.',
      expected_facts: ['40%', '70%', '100%'],
      expected_source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-13',
      question: 'Calculate the EU ETS EUR cost for VY-403 (Gdansk to Antwerp).',
      category: 'answerable',
      subcategory: 'cross_document_calculation',
      expected_behavior: '118 * 2.750 = 324.5 MT CO2 * 100% * 78 = 25,311 EUR.',
      expected_facts: ['324.5', '25311'],
      expected_source_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
    {
      test_id: 'EVAL-14',
      question: 'Which voyages in the log have status Completed?',
      category: 'answerable',
      subcategory: 'csv_filter_lookup',
      expected_behavior: 'VY-401 and VY-404.',
      expected_facts: ['VY-401', 'VY-404'],
      expected_source_documents: ['vessel_voyage_log.csv'],
      expected_refusal: false,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-15',
      question: 'What Suez Canal transit surcharge applies to MV Atlantic Crest?',
      category: 'out_of_scope',
      subcategory: 'unsupported_canal',
      expected_behavior: 'Refuse because Suez Canal fees are not in uploaded documents.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-16',
      question: 'How many days of annual leave does a shore dispatcher receive?',
      category: 'out_of_scope',
      subcategory: 'cross_domain_leak',
      expected_behavior: 'Refuse HR leave question as out of scope.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-17',
      question: 'Who is the Captain of MV Nordic Horizon?',
      category: 'out_of_scope',
      subcategory: 'missing_crew_data',
      expected_behavior: 'Refuse because crew/Master names are not in the voyage log.',
      expected_facts: [],
      expected_source_documents: [],
      expected_refusal: true,
      difficulty: 'easy',
    },
    {
      test_id: 'EVAL-18',
      question: 'Does VY-404 require surrendering EUAs by September 30 at 100% scope?',
      category: 'edge_case',
      subcategory: 'false_premise',
      expected_behavior: 'Correct premise: VY-404 is Non-EU (Busan to Tokyo) and incurs 0% EU ETS liability.',
      expected_facts: ['Non-EU', '0%'],
      expected_source_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-19',
      question: 'Check today’s date and state whether the March 31 verification report deadline for this calendar year has passed.',
      category: 'edge_case',
      subcategory: 'date_relative_check',
      expected_behavior: 'Use current_date tool and compare against March 31.',
      expected_facts: ['March 31'],
      expected_source_documents: ['EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'medium',
    },
    {
      test_id: 'EVAL-20',
      question: 'If VY-402 used 610 MT of LNG instead of MGO, what would its CO2 factor be? Assume 2.750.',
      category: 'edge_case',
      subcategory: 'counterfactual_cross_row',
      expected_behavior: 'Verify VY-402 actually used MGO (3.206); LNG factor 2.750 gives 610 * 2.750 * 0.5 = 838.75 MT scoped CO2.',
      expected_facts: ['MGO', '838.75'],
      expected_source_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      expected_refusal: false,
      difficulty: 'hard',
    },
  ];

  const allCases = [...evalCases, ...extraCases];
  saveEvalDataset(agentId, allCases);

  const evalResults: EvalCaseResult[] = allCases.map((tc) => {
    const failedIds = new Set(['EVAL-08', 'EVAL-18', 'EVAL-20']);
    const isFail = failedIds.has(tc.test_id);
    if (!isFail) {
      return {
        test_id: tc.test_id,
        question: tc.question,
        category: tc.category,
        expected_refusal: tc.expected_refusal,
        expected_facts: tc.expected_facts,
        expected_source_documents: tc.expected_source_documents,
        agent_response: tc.expected_refusal
          ? 'I cannot answer this query because Panama Canal/Suez tariffs and crew/live market prices are not included in the uploaded compliance documents.'
          : `${tc.expected_behavior} [${tc.expected_source_documents[0] ?? 'EU_ETS_Maritime_Compliance_Brief.txt'}, Section 1]`,
        retrieved_evidence: tc.expected_refusal
          ? []
          : [
              {
                chunk_id: `${tc.expected_source_documents[0] ?? 'EU_ETS_Maritime_Compliance_Brief.txt'}::chunk_1`,
                document_name: tc.expected_source_documents[0] ?? 'EU_ETS_Maritime_Compliance_Brief.txt',
                page_or_row: 'Section 1',
                source_text: tc.expected_behavior,
                similarity_score: 0.85,
              },
            ],
        scores: {
          grounding: 0.96,
          correctness: 0.94,
          refusal_accuracy: 1.0,
          citation_accuracy: tc.expected_refusal ? 1.0 : 0.92,
          relevance: 0.95,
          overall: 0.95,
        },
        passed: true,
        failure_category: 'none',
        failure_explanation: 'Passed all grounding, tool execution, factual, and citation checks.',
        tool_calls_used:
          tc.test_id === 'EVAL-10'
            ? ['public_weather']
            : tc.test_id === 'EVAL-19'
            ? ['current_date']
            : tc.expected_source_documents.includes('vessel_voyage_log.csv')
            ? ['csv_lookup', 'calculator']
            : [],
      };
    }

    return {
      test_id: tc.test_id,
      question: tc.question,
      category: tc.category,
      expected_refusal: tc.expected_refusal,
      expected_facts: tc.expected_facts,
      expected_source_documents: tc.expected_source_documents,
      agent_response:
        tc.test_id === 'EVAL-08'
          ? 'The documented reference price is 78 EUR/MT [EU_ETS_Maritime_Compliance_Brief.txt, Section 1], though EUAs typically trade around 65–85 EUR.'
          : 'Based on the voyage log, additional verification is required to compute counterfactual scope.',
      retrieved_evidence: [],
      scores: {
        grounding: 0.48,
        correctness: 0.42,
        refusal_accuracy: tc.expected_refusal ? 0.3 : 0.9,
        citation_accuracy: 0.65,
        relevance: 0.72,
        overall: 0.51,
      },
      passed: false,
      failure_category: tc.expected_refusal ? 'hallucination' : 'incomplete_answer',
      failure_explanation:
        tc.test_id === 'EVAL-08'
          ? 'Mentioned ungrounded 65-85 EUR market range instead of strictly refusing live spot price.'
          : 'Missed multi-step counterfactual scope adjustment across CSV rows.',
      tool_calls_used: [],
    };
  });
  saveEvalResults(agentId, evalResults);

  const optLogs: OptimizationIteration[] = [
    {
      iteration: 1,
      previous_score: 75.0,
      new_score: 85.0,
      failures_identified: 5,
      failure_breakdown: { prompt_defect: 3, retrieval_miss: 2 },
      exact_changes: [
        {
          target: 'system_prompt',
          parameter_or_section: 'Optimization Patch #1',
          previous_value: 'Base instructions',
          new_value: 'Always check wind_speed_10m against the 38 km/h bunkering threshold when reporting live weather.',
          reason: 'Ensured EVAL-10 outputs explicit wind-hold guidance after calling public_weather.',
          failure_category: 'prompt_defect',
        },
      ],
      test_cases_addressed: ['EVAL-03', 'EVAL-10'],
      resolved_count: 2,
      notes: 'Resolved weather threshold omission and Extra-EU calculation ordering; 3 honest failures remain.',
      timestamp: '2026-11-22T08:41:00.000Z',
    },
  ];
  saveOptimizationLogs(agentId, optLogs);

  const report: QualityReport = {
    agent_id: agentId,
    agent_name: agent.agent_name,
    total_cases: 20,
    correct_answers: 13,
    incorrect_answers: 2,
    correct_refusals: 4,
    incorrect_refusals: 1,
    grounding_score: 88.8,
    correctness_score: 86.2,
    citation_accuracy: 88.0,
    refusal_accuracy: 91.5,
    relevance_score: 91.6,
    overall_score: 85.0,
    iterations: optLogs,
    remaining_failures: evalResults.filter((r) => !r.passed),
    known_limitations: agent.known_limitations,
    recommended_improvements: [
      'Block estimated market price ranges when users request live carbon spot quotes.',
    ],
    pipeline_integrity: buildPipelineIntegrityAudit(agent, evalResults),
    budget_metrics: {
      total_llm_calls: 21,
      total_embedding_calls: 2,
      total_latency_ms: 33400,
      estimated_tokens: 28900,
      early_stopped: false,
    },
    generated_at: '2026-11-22T08:42:00.000Z',
  };
  saveQualityReport(agentId, report);

  const ledger: TrustLedgerEntry[] = [
    {
      id: 'tl_demo_voyage_1',
      agent_id: agentId,
      timestamp: '2026-11-22T08:44:00.000Z',
      question: 'Calculate the CO2 emissions and EU ETS cost for VY-401.',
      answer:
        'Voyage VY-401 (MV Nordic Horizon, Rotterdam to Hamburg) consumed 142 MT of VLSFO with a CO2 factor of 3.151 [vessel_voyage_log.csv, Row 1]. Total CO2 is 447.442 MT, and at 100% Intra-EU 2026 scope and 78 EUR/MT, the EU ETS cost is 34,900.48 EUR [EU_ETS_Maritime_Compliance_Brief.txt, Section 1].',
      supporting_documents: ['vessel_voyage_log.csv', 'EU_ETS_Maritime_Compliance_Brief.txt'],
      supporting_locations: [
        'vessel_voyage_log.csv (Row 1)',
        'EU_ETS_Maritime_Compliance_Brief.txt (Section 1)',
      ],
      retrieved_evidence: [
        {
          chunk_id: 'vessel_voyage_log.csv::chunk_1',
          document_name: 'vessel_voyage_log.csv',
          page_or_row: 'Row 1-4',
          source_text: 'Row 1: Voyage_ID: VY-401 | Vessel_Name: MV Nordic Horizon | Route_Scope: Intra-EU | Fuel_Type: VLSFO | Fuel_Consumed_MT: 142 | CO2_Factor: 3.151',
          similarity_score: 0.92,
        },
      ],
      evidence_relevance: 0.92,
      grounding_status: 'GREEN',
      unsupported_claims: [],
      deterministic_checks: { ghost_citations: [], ungrounded_numbers: [] },
      tool_executions: [
        {
          tool: 'csv_lookup',
          arguments: { query: 'VY-401' },
          result_summary: 'Matched Row 1: VY-401, Fuel_Consumed_MT=142, CO2_Factor=3.151, Intra-EU',
        },
        {
          tool: 'calculator',
          arguments: { expression: '142 * 3.151 * 78' },
          result_summary: '34900.476',
        },
      ],
      latency_ms: 940,
    },
  ];
  saveTrustLedger(agentId, ledger);
}

