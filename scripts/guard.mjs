#!/usr/bin/env node
// PreToolUse hook: turns two qa-loop rules into guarantees instead of instructions.
//  1. The qa-tester agent is a black box: it may read and write only inside .qa/runs/.
//  2. While a QA run is active, nobody edits product files: results would no longer
//     describe the code under test. `qa-loop verdict` or `qa-loop run close` ends the run.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const ACTIVE_RUN_TTL_MS = 6 * 60 * 60 * 1000;
const PATH_KEYS = { Read: 'file_path', Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path', Grep: 'path', Glob: 'path' };
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const underQaDir = (path) => path.split(sep).includes('.qa');
const underRuns = (path) => {
  const parts = path.split(sep);
  const i = parts.lastIndexOf('.qa');
  return i !== -1 && parts[i + 1] === 'runs';
};

function activeRun(from) {
  let dir = from;
  for (;;) {
    const marker = join(dir, '.qa', 'runs', '.active.json');
    if (existsSync(marker)) {
      try {
        const run = JSON.parse(readFileSync(marker, 'utf8'));
        if (Date.now() - Date.parse(run.started_at) < ACTIVE_RUN_TTL_MS) return run;
      } catch {
        return null;
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const tool = input.tool_name;
const key = PATH_KEYS[tool];
if (!key) process.exit(0);
const cwd = input.cwd || process.cwd();
const raw = input.tool_input?.[key];
const target = raw ? resolve(cwd, raw) : null;
const isTester = /(^|:)qa-tester$/.test(input.agent_type || '');

if (isTester) {
  if (!target) deny(`qa-loop: the tester is a black box; ${tool} needs an explicit path inside the run directory.`);
  if (!underRuns(target)) deny(`qa-loop: the tester is a black box and may only ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} inside .qa/runs/ (blocked: ${raw}).`);
  process.exit(0);
}

if (WRITE_TOOLS.has(tool) && target && isAbsolute(target) && !underQaDir(target)) {
  const run = activeRun(dirname(target)) || activeRun(cwd);
  if (run) {
    deny(
      `qa-loop: QA run ${run.key || ''} is in progress (${run.run_dir}). Product files stay unchanged until it ends, so the results describe the code under test. ` +
        'Finish with `qa-loop verdict --run <run>` or abandon it with `qa-loop run close`.',
    );
  }
}
process.exit(0);
