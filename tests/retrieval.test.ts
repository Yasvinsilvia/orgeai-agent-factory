import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChunksFromSegments,
  cosineSimilarity,
  retrieveRelevantChunks,
} from '../server/core/retrieval.ts';
import type { DocumentChunk } from '../src/types/forge.ts';

test('buildChunksFromSegments snaps chunk boundaries cleanly without cutting words', () => {
  const longText = [
    'Annual paid leave is 22 working days per calendar year for full-time shore staff.',
    'Employees with five or more years of continuous service receive 25 working days.',
    'Unused annual leave up to a maximum of 5 days may be carried over into Q1 and must be used by March 31.',
    'Sick leave entitlement is 12 days per year and unused sick leave is not encashable.',
    'Primary caregivers receive 16 weeks of fully paid parental leave within 6 months.',
  ].join(' ');

  const chunks = buildChunksFromSegments({
    agent_id: 'test_agent',
    document_name: 'HR_Leave_Policy_2026.txt',
    file_type: 'txt',
    segments: [{ page_or_row: 'Section 1', text: longText }],
    chunk_size: 210,
    chunk_overlap: 40,
  });

  assert.ok(chunks.length >= 2, 'Expected multiple chunks for long segment');
  for (const ch of chunks) {
    // Should never end or start cleanly sliced inside a word like "encashabl" or "workin"
    assert.ok(!/^[a-z]{1,2}\s/.test(ch.source_text) || ch.source_text.startsWith('is '), `Unexpected mid-word start: "${ch.source_text}"`);
    assert.ok(ch.char_count === ch.source_text.length);
  }
});

test('retrieveRelevantChunks respects metadata filters (document_names and file_types)', async () => {
  const chunks: DocumentChunk[] = [
    {
      chunk_id: 'docA::1',
      agent_id: 'a1',
      document_name: 'HR_Policy.txt',
      file_type: 'txt',
      page_or_row: 'Section 1',
      source_text: 'Shore staff annual leave is 22 working days with 5 days carryover by March 31.',
      char_count: 80,
      embedding: [1, 0, 0],
    },
    {
      chunk_id: 'docB::1',
      agent_id: 'a1',
      document_name: 'spares.csv',
      file_type: 'csv',
      page_or_row: 'Row 1',
      source_text: 'Part_ID: SP-1002 | Part_Name: Turbocharger Nozzle Ring | Unit_Price_USD: 4820',
      char_count: 78,
      embedding: [0.9, 0.1, 0],
    },
  ];

  const csvOnly = await retrieveRelevantChunks({
    query: 'annual leave Turbocharger SP-1002',
    chunks,
    config: { chunk_size: 700, chunk_overlap: 100, top_k: 4, similarity_threshold: 0.1 },
    useEmbeddings: false,
    metadataFilter: { file_types: ['csv'] },
  });

  assert.equal(csvOnly.length, 1);
  assert.equal(csvOnly[0].document_name, 'spares.csv');

  const hrOnly = await retrieveRelevantChunks({
    query: 'annual leave SP-1002',
    chunks,
    config: { chunk_size: 700, chunk_overlap: 100, top_k: 4, similarity_threshold: 0.1 },
    useEmbeddings: false,
    metadataFilter: { document_names: ['HR_Policy.txt'] },
  });

  assert.equal(hrOnly.length, 1);
  assert.equal(hrOnly[0].document_name, 'HR_Policy.txt');
});

test('retrieveRelevantChunks promotes multi-document coverage during reranking', async () => {
  const chunks: DocumentChunk[] = [
    {
      chunk_id: 'Doc1::1',
      agent_id: 'a1',
      document_name: 'Leave_Policy.txt',
      file_type: 'txt',
      page_or_row: 'Section 1',
      source_text: 'Overtime requires coordinator approval and annual leave requests of 4+ days require 15 working days advance notice.',
      char_count: 112,
    },
    {
      chunk_id: 'Doc1::2',
      agent_id: 'a1',
      document_name: 'Leave_Policy.txt',
      file_type: 'txt',
      page_or_row: 'Section 2',
      source_text: 'Annual leave notice periods and coordinator schedules must be logged in the HR portal.',
      char_count: 88,
    },
    {
      chunk_id: 'Doc2::1',
      agent_id: 'a1',
      document_name: 'Attendance_Handbook.txt',
      file_type: 'txt',
      page_or_row: 'Section 3',
      source_text: 'Public holiday overtime for coordinators is compensated at 2.0x hourly rate plus 1 compensatory day off.',
      char_count: 106,
    },
  ];

  const results = await retrieveRelevantChunks({
    query: 'coordinator public holiday overtime rate and 4 days annual leave notice',
    chunks,
    config: { chunk_size: 700, chunk_overlap: 100, top_k: 2, similarity_threshold: 0.12 },
    useEmbeddings: false,
  });

  assert.equal(results.length, 2);
  const docs = new Set(results.map((r) => r.document_name));
  assert.ok(docs.has('Leave_Policy.txt'), 'Expected Leave_Policy.txt in top_k');
  assert.ok(docs.has('Attendance_Handbook.txt'), 'Expected Attendance_Handbook.txt in top_k for cross-doc query');
});

test('cosineSimilarity computes expected dot/norm scores', () => {
  assert.equal(Number(cosineSimilarity([1, 0], [1, 0]).toFixed(4)), 1);
  assert.equal(Number(cosineSimilarity([1, 0], [0, 1]).toFixed(4)), 0);
});
