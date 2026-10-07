import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../scripts/qa-loop.mjs', import.meta.url));
const run = (args, cwd) => JSON.parse(execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' }));

test('run new -> check -> verdict writes a report', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: pl\n');

  const created = run(['run', 'new', '--ticket', 'DEMO-1', '--from', project, '--lang', 'pl'], project);
  assert.equal(created.ok, true);
  assert.equal(created.key, 'DEMO-1');
  assert.match(readFileSync(join(project, '.qa', '.gitignore'), 'utf8'), /runs\//);

  const dir = created.run_dir;
  writeFileSync(
    join(dir, 'plan.json'),
    JSON.stringify({ cases: [{ id: 'AC-1', level: 'acceptance', title: 'Lista się ładuje', expected: '10 wierszy' }] }),
  );
  assert.deepEqual(run(['check', '--run', dir], project).issues, ['results.json: missing']);
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ cases: [], findings: [] }));
  assert.deepEqual(run(['check', '--run', dir], project).issues, ['results.json: no result for planned case AC-1']);

  mkdirSync(join(dir, 'evidence', 'AC-1'), { recursive: true });
  writeFileSync(join(dir, 'evidence', 'AC-1', 'list.png'), 'png');
  writeFileSync(
    join(dir, 'results.json'),
    JSON.stringify({ cases: [{ id: 'AC-1', status: 'PASS', assertion: '10 rows', evidence: ['evidence/AC-1/list.png'] }], findings: [] }),
  );
  assert.equal(run(['check', '--run', dir], project).ok, true);

  const assisted = { id: 'AC-1', status: 'PASS', assertion: '10 rows', evidence: ['evidence/AC-1/list.png'], human_steps: 'evidence/AC-1/human-steps.js' };
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ cases: [assisted], findings: [] }));
  assert.deepEqual(run(['check', '--run', dir], project).issues, [
    'results.json AC-1: human_steps needs assisted (what the human did)',
    'results.json AC-1: human_steps file missing or empty: evidence/AC-1/human-steps.js',
  ]);
  writeFileSync(join(dir, 'evidence', 'AC-1', 'human-steps.js'), 'async page => {}');
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ cases: [{ ...assisted, assisted: 'entered the SMS code' }], findings: [] }));
  assert.equal(run(['check', '--run', dir], project).ok, true);

  const outcome = run(['verdict', '--run', dir], project);
  assert.equal(outcome.verdict, 'ACCEPT');
  assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /ZAAKCEPTOWANE/);
  assert.match(readFileSync(join(dir, 'jira-comment.md'), 'utf8'), /AC-1/);
});

test('an active-run marker exists from run new until the verdict; run close removes it', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: en\n');
  const marker = join(project, '.qa', 'runs', '.active.json');
  const first = run(['run', 'new', '--ticket', 'T-9', '--from', project], project);
  assert.equal(existsSync(marker), true);
  writeFileSync(join(first.run_dir, 'plan.json'), JSON.stringify({ cases: [{ id: 'AC-1', level: 'acceptance', title: 't', expected: 'e' }] }));
  run(['verdict', '--run', first.run_dir], project);
  assert.equal(existsSync(marker), false);
  run(['run', 'new', '--ticket', 'T-9', '--from', project], project);
  assert.equal(run(['run', 'close', '--from', project], project).closed, true);
  assert.equal(existsSync(marker), false);
});

test('env --run writes the browser network guard from env.json', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: en\n');
  const created = run(['run', 'new', '--ticket', 'T-2', '--from', project], project);
  writeFileSync(
    join(created.run_dir, 'env.json'),
    JSON.stringify({ base_url: 'http://127.0.0.1:9', allowed_hosts: ['sso.example.com'], blocked_hosts: ['app.example.com'], strict_hosts: true, roles: {} }),
  );
  let out = '';
  try {
    out = execFileSync('node', [CLI, 'env', '--run', created.run_dir], { cwd: project, encoding: 'utf8' });
  } catch (error) {
    out = error.stdout; // the base URL is unreachable on purpose
  }
  assert.deepEqual(JSON.parse(out).browser_config.allowed_origins, ['http://127.0.0.1:9', 'https://sso.example.com', 'http://sso.example.com']);
  const config = JSON.parse(readFileSync(join(created.run_dir, '.playwright', 'cli.config.json'), 'utf8'));
  assert.deepEqual(config.network.blockedOrigins, ['https://app.example.com', 'http://app.example.com']);
});

test('env --run writes a token identity check for roles without a visible marker', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: en\n');
  const created = run(['run', 'new', '--ticket', 'T-4', '--from', project], project);
  const marker = { jwt_storage_key: 'token', claim: 'email', equals: 'manager@example.com' };
  writeFileSync(join(created.run_dir, 'env.json'), JSON.stringify({ base_url: 'http://127.0.0.1:9', roles: { manager: { marker }, admin: { marker: 'root' } } }));
  let out = '';
  try {
    out = execFileSync('node', [CLI, 'env', '--run', created.run_dir], { cwd: project, encoding: 'utf8' });
  } catch (error) {
    out = error.stdout;
  }
  assert.deepEqual(JSON.parse(out).identity_checks, { manager: 'identity-manager.js' });
  const script = readFileSync(join(created.run_dir, 'identity-manager.js'), 'utf8');
  assert.match(script, /"equals":"manager@example\.com"/);
  assert.doesNotMatch(script, /return \{[^}]*raw/); // never returns the token itself
  // the generated function must be valid JavaScript
  new Function(`return (${script})`);
});

test('evidence packing redacts session cookies and auth headers', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: en\n');
  const created = run(['run', 'new', '--ticket', 'T-3', '--from', project], project);
  const dir = created.run_dir;
  const statePath = join(project, '.qa', 'auth-admin.json');
  writeFileSync(statePath, JSON.stringify({ cookies: [{ name: 'sid', value: 'COOKIE-SECRET-123456' }], origins: [] }));
  writeFileSync(join(dir, 'env.json'), JSON.stringify({ roles: { admin: { state: statePath } } }));
  const traces = join(dir, '.playwright-cli', 'traces');
  mkdirSync(join(traces, 'resources'), { recursive: true });
  writeFileSync(join(traces, 'trace-1.trace'), `${JSON.stringify({ type: 'before', params: { cookie: 'sid=COOKIE-SECRET-123456' } })}\n`);
  const request = { method: 'GET', url: 'https://x/api', headers: [{ name: 'Authorization', value: 'Bearer TOKEN-ABCDEFGH-999' }], cookies: [] };
  writeFileSync(join(traces, 'trace-1.network'), `${JSON.stringify({ type: 'resource-snapshot', snapshot: { request, response: { status: 200, headers: [] } } })}\n`);
  run(['evidence', '--run', dir, '--case', 'AC-1'], project);
  const unpacked = execFileSync('unzip', ['-p', join(dir, 'evidence', 'AC-1', 'trace.zip')], { encoding: 'utf8' });
  assert.doesNotMatch(unpacked, /COOKIE-SECRET-123456|TOKEN-ABCDEFGH-999/);
  assert.match(unpacked, /\[REDACTED\]/);
});

test('redact catches JWTs in URLs and refreshed tokens, in text files and trace zips', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: en\n');
  const created = run(['run', 'new', '--ticket', 'T-5', '--from', project], project);
  const dir = created.run_dir;
  // Built at runtime, so the repository holds no token-shaped string for secret scanners to flag.
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const jwt = [b64('{"alg":"RS256"}'), b64('{"email":"x@y.z"}'), b64('signature-signature')].join('.');
  mkdirSync(join(dir, 'evidence', 'AC-1', 'zip'), { recursive: true });
  writeFileSync(join(dir, 'evidence', 'AC-1', 'network.txt'), `POST https://api.x/defects?token=${jwt} => 200\nGET https://api.x/a?sid=abcdefgh12345 => 200\n`);
  const net = { type: 'resource-snapshot', snapshot: { request: { url: `https://api.x/d?token=${jwt}`, headers: [{ name: 'Authorization', value: `Bearer ${jwt}` }] } } };
  writeFileSync(join(dir, 'evidence', 'AC-1', 'zip', 'trace.network'), `${JSON.stringify(net)}\n`);
  writeFileSync(join(dir, 'evidence', 'AC-1', 'zip', 'trace.trace'), `${JSON.stringify({ type: 'before', params: { url: `/x?token=${jwt}` } })}\n`);
  execFileSync('zip', ['-qr', join(dir, 'evidence', 'AC-1', 'trace.zip'), '.'], { cwd: join(dir, 'evidence', 'AC-1', 'zip') });
  rmSync(join(dir, 'evidence', 'AC-1', 'zip'), { recursive: true });

  const out = run(['redact', '--run', dir], project);
  assert.equal(out.redacted_files, 2);
  const text = readFileSync(join(dir, 'evidence', 'AC-1', 'network.txt'), 'utf8');
  const zipped = execFileSync('unzip', ['-p', join(dir, 'evidence', 'AC-1', 'trace.zip')], { encoding: 'utf8' });
  for (const content of [text, zipped]) assert.doesNotMatch(content, new RegExp(jwt.split('.')[0]));
  assert.match(text, /sid=\[REDACTED\]/);
  assert.equal(run(['redact', '--run', dir], project).redacted_files, 0); // idempotent
});

test('preflight finds the nearest .qa/config.yml', () => {
  const project = mkdtempSync(join(tmpdir(), 'qa-loop-'));
  mkdirSync(join(project, '.qa'));
  mkdirSync(join(project, 'tickets'));
  writeFileSync(join(project, '.qa', 'config.yml'), 'language: en\n');
  writeFileSync(join(project, 'tickets', 'T-1.md'), '# T-1');
  const info = run(['preflight', '--from', join(project, 'tickets', 'T-1.md')], tmpdir());
  assert.equal(info.config, join(project, '.qa', 'config.yml'));
});
