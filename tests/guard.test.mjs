import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url));

function decide(input) {
  const out = execFileSync('node', [GUARD], { input: JSON.stringify(input), encoding: 'utf8' });
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
}

function project({ active = false, startedAt = new Date().toISOString() } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qa-guard-'));
  mkdirSync(join(root, '.qa', 'runs', 'T-1', 'run1'), { recursive: true });
  mkdirSync(join(root, 'src'));
  if (active) writeFileSync(join(root, '.qa', 'runs', '.active.json'), JSON.stringify({ key: 'T-1', run_dir: join(root, '.qa/runs/T-1/run1'), started_at: startedAt }));
  return root;
}

const tester = { agent_type: 'qa-loop:qa-tester' };

test('the tester reads and writes only inside .qa/runs', () => {
  const root = project();
  const run = join(root, '.qa', 'runs', 'T-1', 'run1');
  assert.equal(decide({ ...tester, cwd: root, tool_name: 'Read', tool_input: { file_path: join(run, 'plan.json') } }), 'allow');
  assert.equal(decide({ ...tester, cwd: root, tool_name: 'Write', tool_input: { file_path: join(run, 'results.json') } }), 'allow');
  assert.equal(decide({ ...tester, cwd: root, tool_name: 'Read', tool_input: { file_path: join(root, 'src', 'app.js') } }), 'deny');
  assert.equal(decide({ ...tester, cwd: root, tool_name: 'Read', tool_input: { file_path: join(root, '.qa', 'auth', 'admin.json') } }), 'deny');
  assert.equal(decide({ ...tester, cwd: root, tool_name: 'Grep', tool_input: { pattern: 'password' } }), 'deny');
  assert.equal(decide({ ...tester, cwd: root, tool_name: 'Glob', tool_input: { pattern: '**/*', path: run } }), 'allow');
});

test('product files are read-only while a run is active', () => {
  const root = project({ active: true });
  const edit = (path) => decide({ cwd: root, tool_name: 'Edit', tool_input: { file_path: path } });
  assert.equal(edit(join(root, 'src', 'app.js')), 'deny');
  assert.equal(edit(join(root, '.qa', 'runs', 'T-1', 'run1', 'plan.json')), 'allow');
  assert.equal(edit(join(root, '.qa', 'knowledge.md')), 'allow');
  assert.equal(decide({ cwd: root, tool_name: 'Read', tool_input: { file_path: join(root, 'src', 'app.js') } }), 'allow');
});

test('no active run, or a stale marker, leaves editing alone', () => {
  assert.equal(decide({ cwd: project(), tool_name: 'Write', tool_input: { file_path: '/tmp/x.txt' } }), 'allow');
  const stale = project({ active: true, startedAt: new Date(Date.now() - 7 * 3600e3).toISOString() });
  assert.equal(decide({ cwd: stale, tool_name: 'Edit', tool_input: { file_path: join(stale, 'src', 'app.js') } }), 'allow');
});
