// Deterministic verdict for a qa-loop run.
// The tester reports facts (results.json); this module decides what they prove.
// Rules: a PASS needs an assertion and evidence on disk, a FAIL needs two
// reproductions, and only acceptance criteria or confirmed blocking bugs can reject.

export const CASE_STATUSES = ['PASS', 'FAIL', 'FLAKY', 'BLOCKED', 'NOT_RUN', 'INCONCLUSIVE'];
export const LEVELS = ['acceptance', 'exploratory', 'regression'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const SURFACES = ['browser', 'api'];
export const CATEGORIES = ['functional', 'security', 'ux', 'content', 'visual', 'performance', 'console', 'accessibility', 'links'];
const BLOCKING_SEVERITIES = ['critical', 'high'];
const EXECUTED = ['PASS', 'FAIL', 'FLAKY', 'INCONCLUSIVE', 'UNCONFIRMED', 'WAIVED'];

export function normalize({ plan, results, decisions = {}, fileExists }) {
  const problems = [];
  const reported = new Map((results.cases || []).map((c) => [c.id, c]));
  const plannedIds = new Set(plan.cases.map((c) => c.id));
  const cases = [];

  for (const planned of plan.cases) {
    const result = reported.get(planned.id);
    if (!result) {
      cases.push({ ...planned, status: 'NOT_RUN', original_status: null, status_reason: 'missing_result', evidence: [] });
      problems.push({ id: planned.id, kind: 'missing_result' });
      continue;
    }
    cases.push(normalizeCase({ ...planned, ...result, level: result.level || planned.level }, decisions.cases?.[planned.id], fileExists, problems));
  }
  for (const result of results.cases || []) {
    if (!plannedIds.has(result.id)) {
      cases.push(normalizeCase({ ...result, unplanned: true }, decisions.cases?.[result.id], fileExists, problems));
    }
  }

  const findings = (results.findings || []).map((f) => normalizeFinding(f, decisions.findings?.[f.id], fileExists, problems));
  return { cases, findings, problems };
}

function normalizeCase(c, decision, fileExists, problems) {
  const evidence = (c.evidence || []).filter(Boolean);
  const existing = evidence.filter((e) => fileExists(e));
  const missing = evidence.filter((e) => !fileExists(e));
  if (missing.length) problems.push({ id: c.id, kind: 'missing_evidence_files', files: missing });
  if (!LEVELS.includes(c.level)) problems.push({ id: c.id, kind: 'unknown_level', value: c.level });

  let status = CASE_STATUSES.includes(c.status) ? c.status : 'INCONCLUSIVE';
  let reason = CASE_STATUSES.includes(c.status) ? null : 'unknown_status';
  if (status === 'PASS' && !existing.length) [status, reason] = ['INCONCLUSIVE', 'pass_without_evidence'];
  else if (status === 'PASS' && !String(c.assertion || '').trim()) [status, reason] = ['INCONCLUSIVE', 'pass_without_assertion'];
  else if (status === 'FAIL' && !existing.length) [status, reason] = ['UNCONFIRMED', 'fail_without_evidence'];
  else if (status === 'FAIL' && (Number(c.reproductions) || 0) < 2) [status, reason] = ['UNCONFIRMED', 'fail_not_reproduced'];

  if (decision?.decision === 'waive' && status !== 'PASS') [status, reason] = ['WAIVED', 'waived_by_user'];
  if (decision?.decision === 'fail') [status, reason] = ['FAIL', 'failed_by_user'];

  return { ...c, status, original_status: c.status ?? null, status_reason: reason, evidence: existing, missing_evidence: missing, decision: decision || null };
}

function normalizeFinding(f, decision, fileExists, problems) {
  const evidence = (f.evidence || []).filter(Boolean);
  const existing = evidence.filter((e) => fileExists(e));
  const missing = evidence.filter((e) => !fileExists(e));
  if (missing.length) problems.push({ id: f.id, kind: 'missing_evidence_files', files: missing });

  let type = f.type === 'BUG' ? 'BUG' : 'QUESTION';
  let severity = SEVERITIES.includes(f.severity) ? f.severity : type === 'BUG' ? 'medium' : 'low';
  const related = ['yes', 'no', 'unknown'].includes(f.related_to_change) ? f.related_to_change : 'unknown';
  const confirmed = type === 'BUG' && (Number(f.reproductions) || 0) >= 2 && existing.length > 0;
  let state = 'open';

  switch (decision?.decision) {
    case 'block':
      type = 'BUG';
      state = 'blocking';
      if (!BLOCKING_SEVERITIES.includes(severity)) severity = 'high';
      break;
    case 'follow_up':
      state = 'follow_up';
      break;
    case 'expected':
      state = 'dismissed';
      break;
    default:
      break;
  }

  return { ...f, type, severity, related_to_change: related, confirmed, state, evidence: existing, missing_evidence: missing, decision: decision || null };
}

export function computeVerdict({ cases, findings }) {
  const acceptance = cases.filter((c) => c.level === 'acceptance');
  const open = findings.filter((f) => f.state === 'open');

  const reject = [];
  const failed = acceptance.filter((c) => c.status === 'FAIL');
  if (failed.length) reject.push({ code: 'acceptance_failed', ids: failed.map((c) => c.id) });
  const blocking = [
    ...findings.filter((f) => f.state === 'blocking'),
    ...open.filter((f) => f.type === 'BUG' && f.confirmed && BLOCKING_SEVERITIES.includes(f.severity) && f.related_to_change === 'yes'),
  ];
  if (blocking.length) reject.push({ code: 'blocking_bug', ids: blocking.map((f) => f.id) });
  if (reject.length) return { verdict: 'REJECT', reasons: reject };

  if (!acceptance.length) return { verdict: 'UNTESTABLE', reasons: [{ code: 'no_acceptance_cases', ids: [] }] };
  if (!acceptance.some((c) => EXECUTED.includes(c.status))) {
    return { verdict: 'UNTESTABLE', reasons: [{ code: 'acceptance_not_executed', ids: acceptance.map((c) => c.id) }] };
  }

  const decide = [];
  const unresolved = acceptance.filter((c) => !['PASS', 'WAIVED'].includes(c.status));
  if (unresolved.length) decide.push({ code: 'acceptance_unresolved', ids: unresolved.map((c) => c.id) });
  const questions = open.filter((f) => f.type === 'QUESTION');
  if (questions.length) decide.push({ code: 'open_questions', ids: questions.map((f) => f.id) });
  const bugs = open.filter(
    (f) =>
      f.type === 'BUG' &&
      f.related_to_change !== 'no' &&
      ((f.confirmed && f.severity === 'medium') ||
        (f.confirmed && BLOCKING_SEVERITIES.includes(f.severity) && f.related_to_change === 'unknown') ||
        (!f.confirmed && f.severity !== 'low')),
  );
  if (bugs.length) decide.push({ code: 'bugs_need_decision', ids: bugs.map((f) => f.id) });
  if (decide.length) return { verdict: 'NEEDS_DECISION', reasons: decide };

  return { verdict: 'ACCEPT', reasons: [{ code: 'all_acceptance_passed', ids: [] }] };
}

export function countBy(items, key) {
  return items.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] || 0) + 1 }), {});
}
