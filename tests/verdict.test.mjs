import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, normalize } from '../scripts/lib/verdict.mjs';
import { renderJiraComment, renderReport } from '../scripts/lib/report.mjs';

const EVIDENCE = new Set(['evidence/AC-1/a.png', 'evidence/AC-2/b.png', 'evidence/EX-1/c.png', 'evidence/EX-1/trace.zip']);
const fileExists = (p) => EVIDENCE.has(p);

const plan = {
  title: 'Filtr statusu',
  base_url: 'http://localhost:4317',
  cases: [
    { id: 'AC-1', level: 'acceptance', title: 'Domyślnie „Wszyscy”', expected: 'all users', role: 'admin' },
    { id: 'AC-2', level: 'acceptance', title: 'Filtr „Wyłączeni”', expected: 'only disabled', role: 'admin' },
    { id: 'EX-1', level: 'exploratory', title: 'Szybkie przełączanie filtra', expected: 'last selection wins' },
  ],
};

const pass = (id, evidence) => ({ id, status: 'PASS', assertion: 'checked rows', evidence: [evidence] });
const allPass = () => [pass('AC-1', 'evidence/AC-1/a.png'), pass('AC-2', 'evidence/AC-2/b.png'), pass('EX-1', 'evidence/EX-1/c.png')];
const bug = (overrides = {}) => ({
  id: 'F-1',
  case: 'EX-1',
  type: 'BUG',
  severity: 'high',
  related_to_change: 'yes',
  title: 'Stale response wins',
  steps: ['select all', 'select disabled'],
  expected: 'disabled only',
  actual: 'all users',
  reproductions: 2,
  evidence: ['evidence/EX-1/trace.zip'],
  ...overrides,
});

function decide(results, decisions = {}) {
  const normalized = normalize({ plan, results: { findings: [], ...results }, decisions, fileExists });
  return { normalized, ...computeVerdict(normalized) };
}

test('all acceptance criteria pass with evidence -> ACCEPT', () => {
  assert.equal(decide({ cases: allPass() }).verdict, 'ACCEPT');
});

test('PASS without evidence on disk is not a pass', () => {
  const cases = allPass();
  cases[0].evidence = ['evidence/AC-1/missing.png'];
  const { verdict, normalized } = decide({ cases });
  assert.equal(verdict, 'NEEDS_DECISION');
  assert.equal(normalized.cases[0].status, 'INCONCLUSIVE');
  assert.equal(normalized.cases[0].status_reason, 'pass_without_evidence');
  assert.equal(normalized.problems[0].kind, 'missing_evidence_files');
});

test('PASS without an assertion is not a pass', () => {
  const cases = allPass();
  delete cases[1].assertion;
  const { verdict, normalized } = decide({ cases });
  assert.equal(verdict, 'NEEDS_DECISION');
  assert.equal(normalized.cases[1].status_reason, 'pass_without_assertion');
});

test('FAIL reproduced once is unconfirmed, twice rejects', () => {
  const cases = allPass();
  cases[1] = { id: 'AC-2', status: 'FAIL', expected: 'x', actual: 'y', reproductions: 1, evidence: ['evidence/AC-2/b.png'] };
  assert.equal(decide({ cases }).verdict, 'NEEDS_DECISION');
  assert.equal(decide({ cases }).normalized.cases[1].status, 'UNCONFIRMED');
  cases[1].reproductions = 2;
  const outcome = decide({ cases });
  assert.equal(outcome.verdict, 'REJECT');
  assert.deepEqual(outcome.reasons, [{ code: 'acceptance_failed', ids: ['AC-2'] }]);
});

test('confirmed high bug related to the change rejects', () => {
  assert.equal(decide({ cases: allPass(), findings: [bug()] }).verdict, 'REJECT');
});

test('high bug with unknown relation needs a decision, unrelated one does not block', () => {
  assert.equal(decide({ cases: allPass(), findings: [bug({ related_to_change: 'unknown' })] }).verdict, 'NEEDS_DECISION');
  assert.equal(decide({ cases: allPass(), findings: [bug({ related_to_change: 'no' })] }).verdict, 'ACCEPT');
});

test('a bug seen once is unconfirmed and needs a decision', () => {
  const outcome = decide({ cases: allPass(), findings: [bug({ reproductions: 1 })] });
  assert.equal(outcome.verdict, 'NEEDS_DECISION');
  assert.equal(outcome.normalized.findings[0].confirmed, false);
});

test('low severity bugs do not block acceptance', () => {
  assert.equal(decide({ cases: allPass(), findings: [bug({ severity: 'low' })] }).verdict, 'ACCEPT');
});

test('open question needs a decision; human answers resolve it', () => {
  const question = { id: 'F-2', type: 'QUESTION', related_to_change: 'yes', title: 'Filter lost on refresh', steps: ['refresh'], actual: 'reset to all', evidence: [] };
  assert.equal(decide({ cases: allPass(), findings: [question] }).verdict, 'NEEDS_DECISION');
  assert.equal(decide({ cases: allPass(), findings: [question] }, { findings: { 'F-2': { decision: 'expected' } } }).verdict, 'ACCEPT');
  assert.equal(decide({ cases: allPass(), findings: [question] }, { findings: { 'F-2': { decision: 'follow_up' } } }).verdict, 'ACCEPT');
  assert.equal(decide({ cases: allPass(), findings: [question] }, { findings: { 'F-2': { decision: 'block' } } }).verdict, 'REJECT');
});

test('nothing executed -> UNTESTABLE; missing results count as not run', () => {
  const blocked = [
    { id: 'AC-1', status: 'BLOCKED', blocked_reason: 'no account' },
    { id: 'AC-2', status: 'BLOCKED', blocked_reason: 'no account' },
  ];
  assert.equal(decide({ cases: blocked }).verdict, 'UNTESTABLE');
  const partial = decide({ cases: [pass('AC-1', 'evidence/AC-1/a.png')] });
  assert.equal(partial.verdict, 'NEEDS_DECISION');
  assert.equal(partial.normalized.cases.find((c) => c.id === 'AC-2').status, 'NOT_RUN');
});

test('a human can waive a blocked criterion or fail it', () => {
  const cases = allPass();
  cases[1] = { id: 'AC-2', status: 'BLOCKED', blocked_reason: 'no data' };
  assert.equal(decide({ cases }, { cases: { 'AC-2': { decision: 'waive', note: 'checked manually' } } }).verdict, 'ACCEPT');
  assert.equal(decide({ cases }, { cases: { 'AC-2': { decision: 'fail' } } }).verdict, 'REJECT');
});

test('report shows counts, fix-first list, category, hypothesis, console health, created data and the trace command', () => {
  const cases = allPass();
  cases[1] = { id: 'AC-2', status: 'FAIL', expected: 'only disabled', actual: 'all users', reproductions: 2, evidence: ['evidence/AC-2/b.png'], hypothesis: 'API ignores the filter', repro: 'evidence/AC-2/b.png' };
  const results = { cases, findings: [bug({ category: 'functional', hypothesis: 'stale response wins' })], created_data: ['User QA-1 in store Warsaw'] };
  const normalized = normalize({ plan, results, decisions: {}, fileExists });
  const report = renderReport({
    lang: 'pl',
    run: { ticket: 'DEMO-1', key: 'DEMO-1' },
    plan,
    normalized,
    verdict: computeVerdict(normalized),
    results,
    consoleHealth: [{ message: '[PAGEERROR] TypeError: x', count: 3, cases: ['EX-1', 'EX-2'] }],
  });
  assert.match(report, /Znaleziska: 1 high/);
  assert.match(report, /Do poprawy w pierwszej kolejności[\s\S]*1\. F-1 \(high\)[\s\S]*2\. AC-2/);
  assert.match(report, /\[funkcjonalny\]/);
  assert.match(report, /Hipoteza \(niezweryfikowana\):\*\* API ignores the filter/);
  assert.match(report, /Błędy w konsoli[\s\S]*TypeError: x \| 3 \| EX-1, EX-2/);
  assert.match(report, /Dane utworzone podczas testu[\s\S]*QA-1/);
  assert.match(report, /Automatyczne odtworzenie/);
  assert.match(report, /qa-loop trace "evidence\/EX-1\/trace\.zip"/);
});

test('cases a human helped with are listed up front, with their recorded steps in the local report only', () => {
  const cases = allPass();
  cases[0] = { ...cases[0], assisted: 'entered the SMS code', human_steps: 'evidence/AC-1/human-steps.js' };
  cases[1] = { id: 'AC-2', status: 'FAIL', expected: 'only disabled', actual: 'all users', reproductions: 2, evidence: ['evidence/AC-2/b.png', 'evidence/AC-2/trace.zip', 'evidence/AC-2/replay.webm'] };
  const results = { cases, findings: [] };
  const normalized = normalize({ plan, results, decisions: {}, fileExists: (p) => fileExists(p) || /AC-2\/(trace\.zip|replay\.webm)$/.test(p) });
  const input = { lang: 'en', run: { ticket: 'DEMO-1' }, plan, normalized, verdict: computeVerdict(normalized), results };
  const report = renderReport(input);
  assert.match(report, /🧑 \*\*With human help:\*\* AC-1 \(entered the SMS code, \[human-steps\.js\]\(evidence\/AC-1\/human-steps\.js\)\)/);
  assert.match(report, /\[b\.png\]\([^)]*\) · \[replay\.webm\]\([^)]*\) · \[trace\.zip\]/); // video before trace
  const comment = renderJiraComment(input);
  assert.match(comment, /With human help:\*\* AC-1 \(entered the SMS code\)/);
  assert.doesNotMatch(comment, /human-steps\.js/);
});

test('question counts are pluralized in both languages', () => {
  const q = (id) => ({ id, type: 'QUESTION', related_to_change: 'yes', title: 'q', steps: ['x'], actual: 'y', evidence: [] });
  const render = (lang, n) => {
    const results = { cases: allPass(), findings: Array.from({ length: n }, (_, i) => q(`F-${i + 1}`)) };
    const normalized = normalize({ plan, results, decisions: {}, fileExists });
    return renderReport({ lang, run: { ticket: 'T' }, plan, normalized, verdict: computeVerdict(normalized), results });
  };
  assert.match(render('en', 1), /1 question\b/);
  assert.match(render('en', 2), /2 questions/);
  assert.match(render('pl', 1), /1 pytanie/);
  assert.match(render('pl', 3), /3 pytania/);
  assert.match(render('pl', 5), /5 pytań/);
});

test('reports render in both languages', () => {
  const results = { cases: allPass(), findings: [bug({ related_to_change: 'unknown' })], coverage_notes: ['CSV export not tested'] };
  const normalized = normalize({ plan, results, decisions: {}, fileExists });
  const outcome = computeVerdict(normalized);
  const run = { ticket: 'DEMO-1', created_at: '2026-10-07T12:00:00Z', run_dir_rel: '.qa/runs/DEMO-1/x' };
  for (const lang of ['pl', 'en']) {
    const input = { lang, run, plan, normalized, verdict: outcome, results };
    const report = renderReport(input);
    const jira = renderJiraComment(input);
    assert.match(report, /DEMO-1/);
    assert.match(report, /AC-2/);
    assert.match(report, /F-1/);
    assert.match(report, /CSV export not tested/);
    assert.match(jira, lang === 'pl' ? /WYMAGA DECYZJI/ : /NEEDS DECISION/);
  }
});
