// Markdown rendering for qa-loop runs: the full local report and the Jira comment.

const TEXT = {
  pl: {
    verdict: { ACCEPT: '✅ ZAAKCEPTOWANE', REJECT: '❌ ODRZUCONE', NEEDS_DECISION: '❓ WYMAGA DECYZJI', UNTESTABLE: '⛔ NIE DO PRZETESTOWANIA' },
    status: {
      PASS: '✅ PASS', FAIL: '❌ FAIL', FLAKY: '⚠️ NIESTABILNY', BLOCKED: '⛔ ZABLOKOWANY', NOT_RUN: '⏭️ NIE WYKONANO',
      INCONCLUSIVE: '❔ NIEROZSTRZYGNIĘTY', UNCONFIRMED: '⚠️ NIEPOTWIERDZONY', WAIVED: '☑️ RYZYKO ZAAKCEPTOWANE',
    },
    statusReason: {
      pass_without_evidence: 'PASS bez pliku z dowodem', pass_without_assertion: 'PASS bez opisanej asercji',
      fail_without_evidence: 'FAIL bez pliku z dowodem', fail_not_reproduced: 'błąd nie został odtworzony drugi raz',
      waived_by_user: 'zaakceptowane przez człowieka', failed_by_user: 'oznaczone jako FAIL przez człowieka',
      missing_result: 'tester nie zwrócił wyniku', unknown_status: 'nieznany status od testera',
    },
    reason: {
      acceptance_failed: 'Niespełnione kryteria akceptacji', blocking_bug: 'Błędy blokujące',
      no_acceptance_cases: 'Brak kryteriów akceptacji do sprawdzenia', acceptance_not_executed: 'Żadnego kryterium nie udało się wykonać',
      acceptance_unresolved: 'Kryteria bez rozstrzygnięcia', open_questions: 'Otwarte pytania do decyzji',
      bugs_need_decision: 'Błędy do oceny', all_acceptance_passed: 'Wszystkie kryteria akceptacji spełnione, brak blokujących błędów',
    },
    type: { BUG: '❌ BŁĄD', QUESTION: '❓ PYTANIE' },
    related: { yes: 'tak', no: 'nie (prawdopodobnie istniał wcześniej)', unknown: 'nie wiadomo' },
    h: {
      env: 'Środowisko', date: 'Data', mode: 'Tryb', code: 'Kod', acceptance: 'Kryteria akceptacji', details: 'Co nie działa i pytania',
      other: 'Testy eksploracyjne i regresyjne', untested: 'Nieprzetestowane i ograniczenia', followUp: 'Do osobnego ticketu / do rozważenia',
      criterion: 'Kryterium', result: 'Wynik', proof: 'Dowód / uwagi', goal: 'Cel', steps: 'Kroki', expected: 'Oczekiwane',
      actual: 'Faktycznie', reproduced: 'Odtworzono', relatedToChange: 'Związane ze zmianą', evidence: 'Dowody', why: 'Powód',
      evidenceDir: 'Dowody lokalnie', evidenceKinds: 'trace, screenshoty, konsola, network', trace: 'Podgląd trace', roles: 'role',
      problems: 'Uwagi do jakości przebiegu', fixFirst: 'Do poprawy w pierwszej kolejności', counts: 'Znaleziska',
      questions: (n) => (n === 1 ? 'pytanie' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'pytania' : 'pytań'), hypothesis: 'Hipoteza (niezweryfikowana)', repro: 'Automatyczne odtworzenie',
      consoleHealth: 'Błędy w konsoli (wszystkie przypadki)', message: 'Komunikat', count: 'Ile razy', cases: 'Przypadki',
      createdData: 'Dane utworzone podczas testu',
      reproHowTo: 'Skrypt repro uruchamiasz w sesji zalogowanej roli: `playwright-cli -s=<sesja> run-code --filename=<plik>`; zwraca { reproduced, observed }.',
      footer: 'Raport: qa-loop. Werdykt liczony regułami z wyników testera, nie z jego opinii.',
    },
    category: {
      functional: 'funkcjonalny', security: 'bezpieczeństwo', ux: 'UX', content: 'treść', visual: 'wygląd',
      performance: 'wydajność', console: 'konsola', accessibility: 'dostępność', links: 'linki',
    },
  },
  en: {
    verdict: { ACCEPT: '✅ ACCEPTED', REJECT: '❌ REJECTED', NEEDS_DECISION: '❓ NEEDS DECISION', UNTESTABLE: '⛔ UNTESTABLE' },
    status: {
      PASS: '✅ PASS', FAIL: '❌ FAIL', FLAKY: '⚠️ FLAKY', BLOCKED: '⛔ BLOCKED', NOT_RUN: '⏭️ NOT RUN',
      INCONCLUSIVE: '❔ INCONCLUSIVE', UNCONFIRMED: '⚠️ UNCONFIRMED', WAIVED: '☑️ RISK ACCEPTED',
    },
    statusReason: {
      pass_without_evidence: 'PASS without an evidence file', pass_without_assertion: 'PASS without a stated assertion',
      fail_without_evidence: 'FAIL without an evidence file', fail_not_reproduced: 'failure was not reproduced a second time',
      waived_by_user: 'accepted by a human', failed_by_user: 'marked FAIL by a human',
      missing_result: 'the tester returned no result', unknown_status: 'unknown status from the tester',
    },
    reason: {
      acceptance_failed: 'Failed acceptance criteria', blocking_bug: 'Blocking bugs',
      no_acceptance_cases: 'No acceptance criteria to check', acceptance_not_executed: 'No acceptance criterion could be executed',
      acceptance_unresolved: 'Unresolved acceptance criteria', open_questions: 'Open questions to decide',
      bugs_need_decision: 'Bugs to assess', all_acceptance_passed: 'All acceptance criteria met, no blocking bugs',
    },
    type: { BUG: '❌ BUG', QUESTION: '❓ QUESTION' },
    related: { yes: 'yes', no: 'no (likely pre-existing)', unknown: 'unknown' },
    h: {
      env: 'Environment', date: 'Date', mode: 'Mode', code: 'Code', acceptance: 'Acceptance criteria', details: 'What is wrong and open questions',
      other: 'Exploratory and regression checks', untested: 'Not tested and limits', followUp: 'Separate ticket / worth considering',
      criterion: 'Criterion', result: 'Result', proof: 'Evidence / notes', goal: 'Goal', steps: 'Steps', expected: 'Expected',
      actual: 'Actual', reproduced: 'Reproduced', relatedToChange: 'Related to the change', evidence: 'Evidence', why: 'Reason',
      evidenceDir: 'Evidence (local)', evidenceKinds: 'trace, screenshots, console, network', trace: 'Open a trace', roles: 'roles',
      problems: 'Run quality notes', fixFirst: 'Fix first', counts: 'Findings', questions: (n) => (n === 1 ? 'question' : 'questions'),
      hypothesis: 'Hypothesis (unverified)', repro: 'Automated reproduction', consoleHealth: 'Console errors (all cases)',
      message: 'Message', count: 'Count', cases: 'Cases', createdData: 'Data created during the test',
      reproHowTo: 'Run a repro script in a session logged in as the role: `playwright-cli -s=<session> run-code --filename=<file>`; it returns { reproduced, observed }.',
      footer: 'Report: qa-loop. The verdict is computed by rules from the tester’s results, not from its opinion.',
    },
    category: {
      functional: 'functional', security: 'security', ux: 'UX', content: 'content', visual: 'visual',
      performance: 'performance', console: 'console', accessibility: 'accessibility', links: 'links',
    },
  },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const STATE_ORDER = { blocking: 0, open: 1, follow_up: 2, dismissed: 3 };
const PROBLEM_STATUSES = ['FAIL', 'UNCONFIRMED', 'FLAKY'];
const IMAGE = /\.(png|jpe?g|webp)$/i;

export const texts = (lang) => TEXT[lang] || TEXT.en;

export function reasonLine(lang, reasons) {
  const t = texts(lang);
  return reasons.map((r) => `${t.reason[r.code] || r.code}${r.ids?.length ? `: ${r.ids.join(', ')}` : ''}`).join('; ');
}

const cell = (value, max = 160) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const link = (path) => `[${path.split('/').pop()}](${encodeURI(path)})`;
const image = (path) => `![${path.split('/').pop()}](${encodeURI(path)})`;

function pickEvidence(evidence = [], max = 3) {
  const rank = (p) => (IMAGE.test(p) ? 0 : /trace\.zip$/i.test(p) ? 1 : 2);
  return [...evidence].sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

function caseNote(lang, c) {
  const t = texts(lang);
  const parts = [];
  if (c.status_reason) parts.push(t.statusReason[c.status_reason] || c.status_reason);
  parts.push(c.status === 'PASS' || c.status === 'WAIVED' ? c.assertion || c.decision?.note : c.blocked_reason || c.actual);
  if (c.decision?.note && c.status !== 'WAIVED') parts.push(c.decision.note);
  return parts.filter(Boolean).join(' — ');
}

function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (a.type === b.type ? 0 : a.type === 'BUG' ? -1 : 1) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

const isFollowUp = (f) => f.state === 'follow_up' || (f.state === 'open' && f.type === 'BUG' && (f.related_to_change === 'no' || f.severity === 'low'));

function codeLine(run) {
  const prs = (run.context?.sources || []).filter((s) => s.kind === 'pr').map((s) => `${s.url || `#${s.number}`}${s.head_sha ? ` @ ${s.head_sha}` : ''}`);
  if (prs.length) return prs.join(', ');
  return [run.git?.branch, run.git?.head].filter(Boolean).join(' @ ') || '—';
}

function header(lang, run, plan) {
  const t = texts(lang);
  const roles = [...new Set(plan.cases.map((c) => c.role).filter(Boolean))];
  return [
    '| | |',
    '|---|---|',
    `| ${t.h.env} | ${cell(plan.base_url || '—')} |`,
    `| ${t.h.date} | ${cell(run.created_at || '')}${run.duration_min ? ` · ${run.duration_min} min` : ''} |`,
    `| ${t.h.mode} | ${cell(plan.mode || run.mode || 'standard')}${roles.length ? ` · ${t.h.roles}: ${cell(roles.join(', '))}` : ''} |`,
    `| ${t.h.code} | ${cell(codeLine(run))} |`,
  ].join('\n');
}

// One problem: a failed acceptance case or a finding. Same shape in the report and in Jira.
function detailBlock(lang, item, { local, heading = '###' }) {
  const t = texts(lang);
  const isFinding = Boolean(item.type);
  const label = isFinding ? `${t.type[item.type]}${item.type === 'BUG' ? ` (${item.severity})` : ''}` : t.status[item.status];
  const category = item.category ? ` [${t.category[item.category] || item.category}]` : '';
  const lines = [`${heading} ${item.id} · ${label}${category} — ${item.title || item.charter || ''}`];
  if (item.steps?.length) lines.push(`- **${t.h.steps}:** ${item.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}`);
  if (item.expected) lines.push(`- **${t.h.expected}:** ${item.expected}`);
  if (item.actual) lines.push(`- **${t.h.actual}:** ${item.actual}`);
  if (item.hypothesis) lines.push(`- **${t.h.hypothesis}:** ${item.hypothesis}`);
  const meta = [];
  if (!isFinding || item.type === 'BUG') meta.push(`**${t.h.reproduced}:** ${Number(item.reproductions) || 0}×`);
  if (isFinding) meta.push(`**${t.h.relatedToChange}:** ${t.related[item.related_to_change]}`);
  if (!isFinding && item.status_reason) meta.push(`**${t.h.why}:** ${t.statusReason[item.status_reason] || item.status_reason}`);
  lines.push(`- ${meta.join(' · ')}`);
  if (item.decision?.note) lines.push(`- ${item.decision.note}`);
  if (local && item.repro) lines.push(`- **${t.h.repro}:** ${link(item.repro)}`);
  if (local && item.evidence?.length) {
    lines.push(`- **${t.h.evidence}:** ${pickEvidence(item.evidence, 5).map(link).join(' · ')}`);
    // Screenshots are numbered in order; the last ones usually show the failure itself.
    const shots = item.evidence.filter((p) => IMAGE.test(p)).slice(-2);
    if (shots.length) lines.push('', ...shots.map(image));
  }
  return lines.join('\n');
}

// Coverage notes that start with a case ID are dropped when that case is already
// listed as untested, or when a human decision has since resolved it.
function coverageNotes(results, cases, untested) {
  const skip = new Set([...untested.map((c) => c.id), ...cases.filter((c) => c.decision).map((c) => c.id)]);
  return (results.coverage_notes || []).filter((note) => !skip.has(String(note).match(/^([A-Z]{2}-\d+[A-Z]?)\b/)?.[1]));
}

function partition(normalized) {
  const { cases, findings } = normalized;
  return {
    acceptance: cases.filter((c) => c.level === 'acceptance'),
    others: cases.filter((c) => c.level !== 'acceptance'),
    failedCases: cases.filter((c) => c.level === 'acceptance' && PROBLEM_STATUSES.includes(c.status)),
    shown: sortFindings(findings.filter((f) => f.state !== 'dismissed' && !isFollowUp(f))),
    followUps: sortFindings(findings.filter(isFollowUp)),
    untested: cases.filter((c) => ['BLOCKED', 'NOT_RUN'].includes(c.status)),
  };
}

function countsLine(lang, findings) {
  const t = texts(lang);
  const active = findings.filter((f) => f.state !== 'dismissed');
  const bugs = Object.keys(SEVERITY_ORDER)
    .map((sev) => [sev, active.filter((f) => f.type === 'BUG' && f.severity === sev).length])
    .filter(([, n]) => n)
    .map(([sev, n]) => `${n} ${sev}`);
  const questions = active.filter((f) => f.type === 'QUESTION').length;
  const parts = [...bugs, ...(questions ? [`${questions} ${t.h.questions(questions)}`] : [])];
  return parts.length ? `${t.h.counts}: ${parts.join(' · ')}` : null;
}

// gstack's "Top 3 things to fix", most severe first. A bug that explains a failed
// criterion (its `case`) stands in for it, so one root cause isn't listed twice.
function fixFirst(lang, failedCases, shown) {
  const t = texts(lang);
  const bugs = shown
    .filter((f) => f.type === 'BUG' && (f.state === 'blocking' || ['critical', 'high'].includes(f.severity)))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const explained = new Set(bugs.map((f) => f.case).filter(Boolean));
  const critical = bugs.filter((f) => f.severity === 'critical');
  const cases = failedCases.filter((c) => c.status === 'FAIL' && !explained.has(c.id));
  const rest = bugs.filter((f) => f.severity !== 'critical');
  return [...critical, ...rest, ...cases].slice(0, 3).map((x) =>
    x.type ? `${x.id} (${x.severity}) — ${x.title}${x.case ? ` [${x.case}]` : ''}` : `${x.id} ${t.status[x.status]} — ${x.title}`,
  );
}

export function renderReport({ lang = 'en', run, plan, normalized, verdict, results, consoleHealth = [] }) {
  const t = texts(lang);
  const { acceptance, others, failedCases, shown, followUps, untested } = partition(normalized);
  const out = [`# QA ${run.key || run.ticket} — ${t.verdict[verdict.verdict]}`, ''];
  if (plan.title) out.push(`**${plan.title}**`, '');
  out.push(reasonLine(lang, verdict.reasons), '');
  const counts = countsLine(lang, normalized.findings);
  if (counts) out.push(counts, '');
  const top = fixFirst(lang, failedCases, shown);
  if (top.length) out.push(`**${t.h.fixFirst}:**`, '', ...top.map((line, i) => `${i + 1}. ${line}`), '');
  out.push(header(lang, run, plan), '');

  out.push(`## ${t.h.acceptance}`, '', `| # | ${t.h.criterion} | ${t.h.result} | ${t.h.proof} |`, '|---|---|---|---|');
  for (const c of acceptance) {
    const proof = [cell(caseNote(lang, c), 140), ...pickEvidence(c.evidence, 2).map(link)].filter(Boolean).join(' ');
    out.push(`| ${c.id} | ${cell(c.title, 140)} | ${t.status[c.status]} | ${proof} |`);
  }
  out.push('');

  if (failedCases.length || shown.length) {
    out.push(`## ${t.h.details}`, '');
    for (const item of [...failedCases, ...shown]) out.push(detailBlock(lang, item, { local: true }), '');
  }

  if (others.length) {
    out.push(`## ${t.h.other}`, '', `| # | ${t.h.goal} | ${t.h.result} | ${t.h.proof} |`, '|---|---|---|---|');
    for (const c of others) {
      const proof = [cell(caseNote(lang, c), 140), ...pickEvidence(c.evidence, 1).map(link)].filter(Boolean).join(' ');
      out.push(`| ${c.id} | ${cell(c.title || c.charter, 140)} | ${t.status[c.status]} | ${proof} |`);
    }
    out.push('');
  }

  if (consoleHealth.length) {
    out.push(`## ${t.h.consoleHealth}`, '', `| ${t.h.message} | ${t.h.count} | ${t.h.cases} |`, '|---|---|---|');
    for (const e of consoleHealth) out.push(`| ${cell(e.message, 160)} | ${e.count} | ${e.cases.join(', ')} |`);
    out.push('');
  }

  if (results.created_data?.length) {
    out.push(`## ${t.h.createdData}`, '', ...results.created_data.map((d) => `- ${d}`), '');
  }

  const notes = coverageNotes(results, normalized.cases, untested);
  if (untested.length || notes.length) {
    out.push(`## ${t.h.untested}`, '');
    for (const c of untested) out.push(`- ${c.id} ${c.title || c.charter || ''} — ${caseNote(lang, c) || t.status[c.status]}`);
    for (const n of notes) out.push(`- ${n}`);
    out.push('');
  }

  if (followUps.length) {
    out.push(`## ${t.h.followUp}`, '');
    for (const f of followUps) out.push(`- ${f.id} ${t.type[f.type]}${f.type === 'BUG' ? ` (${f.severity})` : ''} — ${f.title || ''}`);
    out.push('');
  }

  if (normalized.problems.length) {
    out.push(`## ${t.h.problems}`, '');
    for (const p of normalized.problems) out.push(`- ${p.id}: ${p.kind}${p.files ? ` (${p.files.join(', ')})` : ''}`);
    out.push('');
  }

  const trace = [...failedCases, ...shown, ...normalized.cases].flatMap((x) => x.evidence || []).find((p) => /trace\.zip$/i.test(p));
  out.push('---', `${t.h.evidenceDir}: \`${run.run_dir || run.run_dir_rel || '.'}\``);
  if (trace) out.push('', `${t.h.trace}:`, '', '```bash', `${run.trace_viewer || 'qa-loop trace'} "${run.run_dir ? `${run.run_dir}/${trace}` : trace}"`, '```');
  if ([...failedCases, ...shown].some((x) => x.repro)) out.push('', t.h.reproHowTo);
  out.push('', `_${t.h.footer}_`, '');
  return out.join('\n');
}

export function renderJiraComment({ lang = 'en', run, plan, normalized, verdict, results }) {
  const t = texts(lang);
  const { acceptance, failedCases, shown, followUps, untested } = partition(normalized);
  const out = [`**QA: ${t.verdict[verdict.verdict]}** — ${reasonLine(lang, verdict.reasons)}`, ''];
  const counts = countsLine(lang, normalized.findings);
  if (counts) out.push(counts, '');
  const top = fixFirst(lang, failedCases, shown);
  if (top.length) out.push(`**${t.h.fixFirst}:**`, '', ...top.map((line, i) => `${i + 1}. ${line}`), '');
  out.push(`${t.h.env}: ${plan.base_url || '—'} · ${run.created_at || ''} · ${t.h.mode}: ${plan.mode || 'standard'}`, '');
  out.push(`**${t.h.acceptance}**`, '', `| # | ${t.h.criterion} | ${t.h.result} |`, '|---|---|---|');
  for (const c of acceptance) {
    const note = c.status === 'PASS' ? '' : ` — ${cell(caseNote(lang, c), 120)}`;
    out.push(`| ${c.id} | ${cell(c.title, 120)} | ${t.status[c.status]}${note} |`);
  }
  out.push('');
  if (failedCases.length || shown.length) {
    out.push(`**${t.h.details}**`, '');
    for (const item of [...failedCases, ...shown]) out.push(detailBlock(lang, item, { local: false, heading: '####' }), '');
  }
  const notes = coverageNotes(results, normalized.cases, untested);
  if (untested.length || notes.length) {
    out.push(`**${t.h.untested}:** ${[...untested.map((c) => `${c.id} (${caseNote(lang, c) || t.status[c.status]})`), ...notes].join('; ')}`, '');
  }
  if (followUps.length) out.push(`**${t.h.followUp}:** ${followUps.map((f) => `${f.id} ${f.title || ''}`).join('; ')}`, '');
  if (results.created_data?.length) out.push(`**${t.h.createdData}:** ${results.created_data.join('; ')}`, '');
  out.push(`_${t.h.evidenceDir}: ${run.run_dir_rel || '.'} (${t.h.evidenceKinds}). ${t.h.footer}_`);
  return out.join('\n');
}
