#!/usr/bin/env node
// qa-loop CLI: deterministic helpers for the qa-loop skills and the qa-tester agent.
// Every command prints JSON on stdout, so the model reads facts instead of prose.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CASE_STATUSES, CATEGORIES, LEVELS, SEVERITIES, SURFACES, computeVerdict, countBy, normalize } from './lib/verdict.mjs';
import { reasonLine, renderJiraComment, renderReport } from './lib/report.mjs';
import { maskSecretFields, parseRecording, stepsScript } from './lib/steps.mjs';

const USAGE = `qa-loop <command> [options]
  preflight [--from PATH]                       project, config, git and tool status
  run new --ticket KEY [--from PATH] [--mode quick|standard|deep] [--lang pl|en] [--retest]
  context --run DIR [--pr URL]... [--base REF]  changed files and the areas they touch
  run close [--from PATH]                       end an abandoned run (product files become editable again)
  env --run DIR | [--url URL] [--state FILE]... app reachability, saved logins; with --run also the browser network guard
  begin --run DIR --case ID --session NAME      start a case: clear console/network, start the trace
  end --run DIR --case ID --session NAME        finish a case: save console, network, DOM and trace.zip
  watch --run DIR [--session NAME] [--stop]     open the live view of the run's browser sessions; --stop closes it
  assist start|stop --run DIR --case ID --session NAME
                                                a human acts in the tester's session: record it, then save the steps (secrets masked)
  evidence --run DIR --case ID                  pack the latest playwright-cli trace into evidence/ID/trace.zip
  check --run DIR                               validate plan.json and results.json
  verdict --run DIR                             redact evidence, compute the verdict, write report.md and jira-comment.md
  redact --run DIR                              re-apply secret redaction to every file in evidence/
  trace PATH [--port N]                         open a trace.zip in the trace viewer bundled with playwright-cli`;

const MULTI = new Set(['pr', 'state']);
const AREAS = [
  ['permissions', /(permission|acl|polic(y|ies)|\broles?\b|rbac|access|guard|auth)/i],
  ['routing', /(route|router|routing|menu|navigation|\bnav\b|sitemap)/i],
  ['api', /(\/api\/|controller|endpoint|handler|resolver|graphql)/i],
  ['data', /(model|schema|entit(y|ies)|migration|prisma|repositor|dto|\.sql$)/i],
  ['ui', /(\.(jsx|tsx|vue|svelte|html?|hbs|twig)$|components?\/|scenes?\/|pages?\/|views?\/|screens?\/)/i],
  ['styles', /\.(css|scss|sass|less|styl)$/i],
  ['i18n', /(i18n|locales?\/|translations?|\/lang\/)/i],
  ['config', /(config|\.env|settings|docker|compose|helm|k8s|\.ya?ml$|package\.json$)/i],
  ['tests', /(\.test\.|\.spec\.|__tests__|\/tests?\/|e2e|cypress|playwright)/i],
  ['docs', /(\.(md|mdx|adoc|rst)$|\/docs?\/)/i],
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const key = token.slice(2, eq === -1 ? undefined : eq);
    let value = eq === -1 ? undefined : token.slice(eq + 1);
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i++;
      } else value = true;
    }
    if (MULTI.has(key)) (args[key] ||= []).push(value);
    else args[key] = value;
  }
  return args;
}

const print = (data) => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
const fail = (error, extra = {}) => {
  print({ ok: false, error, ...extra });
  process.exit(1);
};
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function sh(cmd, args, options = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, ...options }).trim();
  } catch {
    return null;
  }
}

function findProject(from) {
  let dir = resolve(text(from) || process.cwd());
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  const start = dir;
  for (;;) {
    if (existsSync(join(dir, '.qa', 'config.yml'))) return { root: dir, config: join(dir, '.qa', 'config.yml') };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { root: sh('git', ['-C', start, 'rev-parse', '--show-toplevel']) || start, config: null };
}

function gitInfo(root) {
  if (sh('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']) !== 'true') return null;
  const git = (...args) => sh('git', ['-C', root, ...args]);
  const status = git('status', '--porcelain') || '';
  const originHead = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  const defaultBranch =
    originHead?.replace(/^origin\//, '') ||
    ['main', 'master', 'develop'].find((b) => git('rev-parse', '--verify', '--quiet', b) !== null) ||
    null;
  return {
    root: git('rev-parse', '--show-toplevel'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    head: git('rev-parse', '--short', 'HEAD'),
    dirty_files: status ? status.split('\n').length : 0,
    default_branch: defaultBranch,
  };
}

// Traces recorded by playwright-cli need a viewer of the same Playwright version,
// which is the playwright-core bundled with it (trace.playwright.dev may be older).
function bundledPlaywrightCore() {
  const bin = sh('which', ['playwright-cli']);
  if (!bin) return null;
  let dir = dirname(realpathSync(bin));
  for (let i = 0; i < 4; i++) {
    const cli = join(dir, 'node_modules', 'playwright-core', 'cli.js');
    if (existsSync(cli)) return cli;
    dir = dirname(dir);
  }
  return null;
}

const TESTED_PLAYWRIGHT_CLI = '0.1.22';

function tools() {
  const version = sh('playwright-cli', ['--version']);
  const minor = (v) => v?.split('.').slice(0, 2).join('.');
  return {
    playwright_cli: version,
    playwright_cli_tested: TESTED_PLAYWRIGHT_CLI,
    ...(version && minor(version) !== minor(TESTED_PLAYWRIGHT_CLI)
      ? { playwright_cli_warning: `qa-loop was tested with playwright-cli ${TESTED_PLAYWRIGHT_CLI}; ${version} may differ in commands or output` }
      : {}),
    gh: sh('gh', ['--version'])?.split('\n')[0] ?? null,
    zip: sh('which', ['zip']),
    node: process.version,
  };
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function ensureGitignore(qaDir) {
  mkdirSync(qaDir, { recursive: true });
  const path = join(qaDir, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const missing = ['runs/', 'auth/'].filter((line) => !current.split('\n').includes(line));
  if (missing.length) writeFileSync(path, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

function listRuns(qaDir, limit = 5) {
  const runsDir = join(qaDir, 'runs');
  if (!existsSync(runsDir)) return [];
  const runs = [];
  for (const ticket of readdirSync(runsDir)) {
    const ticketDir = join(runsDir, ticket);
    if (!statSync(ticketDir).isDirectory()) continue;
    for (const name of readdirSync(ticketDir)) {
      const runDir = join(ticketDir, name);
      const verdictPath = join(runDir, 'verdict.json');
      runs.push({ ticket, run: name, run_dir: runDir, verdict: existsSync(verdictPath) ? readJson(verdictPath).verdict : null });
    }
  }
  return runs.sort((a, b) => b.run.localeCompare(a.run)).slice(0, limit);
}

function requireRun(args) {
  const runDir = text(args.run) && resolve(args.run);
  if (!runDir || !existsSync(join(runDir, 'run.json'))) fail('--run must point to a run directory created by `qa-loop run new`', { run: args.run ?? null });
  return runDir;
}

const safeId = (value) => String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-');

// --- commands ---------------------------------------------------------------

function preflight(args) {
  const project = findProject(args.from);
  const qaDir = join(project.root, '.qa');
  const knowledge = join(qaDir, 'knowledge.md');
  print({
    ok: true,
    project_root: project.root,
    config: project.config,
    qa_dir: qaDir,
    knowledge: existsSync(knowledge) ? knowledge : null,
    git: gitInfo(project.root),
    tools: tools(),
    recent_runs: listRuns(qaDir),
  });
}

function runNew(args) {
  const ticket = text(args.ticket);
  if (!ticket) fail('--ticket is required (Jira key or ticket file name)');
  const key = safeId(basename(ticket).replace(/\.(md|txt)$/i, ''));
  const project = findProject(args.from);
  const qaDir = join(project.root, '.qa');
  ensureGitignore(qaDir);
  const ticketDir = join(qaDir, 'runs', key);
  const previous = existsSync(ticketDir)
    ? readdirSync(ticketDir).filter((n) => /^\d{8}-\d{6}/.test(n)).sort().pop() ?? null
    : null;
  const stamp = timestamp();
  let runDir = join(ticketDir, stamp);
  for (let n = 2; existsSync(runDir); n++) runDir = join(ticketDir, `${stamp}-${n}`);
  mkdirSync(join(runDir, 'evidence'), { recursive: true });
  const run = {
    ticket,
    key,
    mode: text(args.mode) || 'standard',
    lang: text(args.lang) || 'en',
    created_at: new Date().toISOString(),
    project_root: project.root,
    config: project.config,
    run_dir: runDir,
    run_dir_rel: relative(project.root, runDir),
    git: gitInfo(project.root),
    retest_of: args.retest && previous ? join(ticketDir, previous) : null,
  };
  writeJson(join(runDir, 'run.json'), run);
  // While this marker exists, the guard hook keeps product files read-only.
  writeJson(join(qaDir, 'runs', '.active.json'), { key, run_dir: runDir, started_at: run.created_at });
  print({ ok: true, ...run, previous_run: previous ? join(ticketDir, previous) : null });
}

function closeActive(qaDir, runDir = null) {
  const marker = join(qaDir, 'runs', '.active.json');
  if (!existsSync(marker)) return false;
  try {
    if (runDir && resolve(readJson(marker).run_dir) !== resolve(runDir)) return false;
  } catch {
    // unreadable marker: remove it
  }
  rmSync(marker, { force: true });
  return true;
}

function runClose(args) {
  const project = findProject(args.from);
  print({ ok: true, closed: closeActive(join(project.root, '.qa')) });
}

function parseNumstat(output, files, source) {
  for (const line of (output || '').split('\n').filter(Boolean)) {
    const [add, del, ...rest] = line.split('\t');
    addFile(files, rest.join('\t'), Number(add) || 0, Number(del) || 0, source);
  }
}

function addFile(files, path, additions, deletions, source) {
  const current = files.get(path) || { path, additions: 0, deletions: 0, sources: [] };
  current.additions += additions;
  current.deletions += deletions;
  if (!current.sources.includes(source)) current.sources.push(source);
  files.set(path, current);
}

const classify = (path) => {
  const hits = AREAS.filter(([, re]) => re.test(path)).map(([name]) => name);
  return hits.length ? hits : ['other'];
};

function context(args) {
  const runDir = requireRun(args);
  const run = readJson(join(runDir, 'run.json'));
  const sources = [];
  const files = new Map();
  const prs = (args.pr || []).filter((p) => typeof p === 'string' && p.trim());

  for (const pr of prs) {
    const raw = sh('gh', ['pr', 'view', pr, '--json', 'number,title,url,state,mergedAt,baseRefName,headRefName,headRefOid,files'], { timeout: 30000 });
    if (!raw) {
      sources.push({ kind: 'pr', url: pr, error: 'gh pr view failed (not logged in, no access, or wrong URL)' });
      continue;
    }
    const data = JSON.parse(raw);
    sources.push({
      kind: 'pr', url: data.url, number: data.number, title: data.title, state: data.state, merged_at: data.mergedAt,
      base: data.baseRefName, head: data.headRefName, head_sha: data.headRefOid?.slice(0, 10) ?? null, files: data.files.length,
    });
    for (const f of data.files) addFile(files, f.path, f.additions, f.deletions, `pr#${data.number}`);
  }

  if (!prs.length && run.git) {
    const root = run.git.root || run.project_root;
    const base = text(args.base) || run.git.default_branch;
    if (base && base !== run.git.branch) {
      const before = files.size;
      parseNumstat(sh('git', ['-C', root, 'diff', '--numstat', `${base}...HEAD`]), files, `branch:${base}...HEAD`);
      sources.push({ kind: 'branch', base, head: run.git.branch, files: files.size - before });
    }
    const before = files.size;
    parseNumstat(sh('git', ['-C', root, 'diff', '--numstat', 'HEAD']), files, 'working-tree');
    for (const path of (sh('git', ['-C', root, 'ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean)) {
      addFile(files, path, 0, 0, 'untracked');
    }
    sources.push({ kind: 'working_tree', files: files.size - before });
  }

  const list = [...files.values()].map((f) => ({ ...f, areas: classify(f.path) }));
  const areas = {};
  for (const f of list) for (const area of f.areas) (areas[area] ||= []).push(f.path);
  writeJson(join(runDir, 'context.json'), { sources, files: list, areas });
  writeJson(join(runDir, 'run.json'), { ...run, context: { sources } });
  print({
    ok: true,
    sources,
    file_count: list.length,
    areas: Object.fromEntries(Object.entries(areas).map(([name, paths]) => [name, paths.length])),
    files: list.slice(0, 80).map((f) => `${f.path} (+${f.additions}/-${f.deletions}) [${f.areas.join(', ')}]`),
    truncated: list.length > 80,
  });
}

function originsFor(hosts = [], baseUrl = null) {
  const origins = new Set();
  if (baseUrl) origins.add(new URL(baseUrl).origin);
  for (const raw of hosts) {
    const host = String(raw || '').trim();
    if (!host) continue;
    if (/^https?:\/\//i.test(host)) origins.add(new URL(host).origin);
    else origins.add(`https://${host}`).add(`http://${host}`);
  }
  return [...origins];
}

// Browser-level network guard, enforced by playwright-cli itself: it loads
// .playwright/cli.config.json from the directory the session is opened in (the run).
function writeBrowserConfig(runDir, envJson) {
  const network = {};
  if (envJson.strict_hosts) network.allowedOrigins = originsFor(envJson.allowed_hosts, envJson.base_url);
  if (envJson.blocked_hosts?.length) network.blockedOrigins = originsFor(envJson.blocked_hosts);
  mkdirSync(join(runDir, '.playwright'), { recursive: true });
  const path = join(runDir, '.playwright', 'cli.config.json');
  writeJson(path, { network });
  return { path, allowed_origins: network.allowedOrigins ?? 'all (strict_hosts is off)', blocked_origins: network.blockedOrigins ?? [] };
}

// For apps that show no identity on screen: a playwright-cli run-code script that
// decodes the app's own JWT from storage and compares one claim. It never returns the token.
function identityScript({ jwt_storage_key: key, claim = 'email', equals }) {
  const params = JSON.stringify({ key, claim, equals });
  return `async page => page.evaluate(({ key, claim, equals }) => {
  const raw = localStorage.getItem(key) || sessionStorage.getItem(key) || '';
  const match = raw.match(/eyJ[\\w-]+\\.([\\w-]+)\\.[\\w-]+/);
  if (!match) return { ok: false, reason: 'no token under storage key ' + key };
  try {
    const json = decodeURIComponent(escape(atob(match[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const claims = JSON.parse(json);
    const expires = claims.exp ? new Date(claims.exp * 1000).toISOString() : null;
    return { ok: claims[claim] === equals, claim, value: claims[claim], expected: equals, token_expires: expires };
  } catch (e) {
    return { ok: false, reason: 'token is not a decodable JWT' };
  }
}, ${params})
`;
}

async function env(args) {
  const result = { ok: true, url: null, states: [] };
  let url = text(args.url);
  if (text(args.run)) {
    const runDir = requireRun(args);
    const envPath = join(runDir, 'env.json');
    if (!existsSync(envPath)) fail('env.json is missing: write it before checking the environment', { run: runDir });
    const envJson = readJson(envPath);
    url ||= envJson.base_url;
    args.state = [...(args.state || []), ...Object.values(envJson.roles || {}).map((r) => r.state).filter(Boolean)];
    result.browser_config = writeBrowserConfig(runDir, envJson);
    result.identity_checks = {};
    for (const [role, def] of Object.entries(envJson.roles || {})) {
      if (def.marker && typeof def.marker === 'object' && def.marker.jwt_storage_key && def.marker.equals) {
        const file = `identity-${safeId(role)}.js`;
        writeFileSync(join(runDir, file), identityScript(def.marker));
        result.identity_checks[role] = file;
      }
    }
  }
  if (url) {
    const started = Date.now();
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      result.url = { url, reachable: true, status: res.status, location: res.headers.get('location'), ms: Date.now() - started };
    } catch (error) {
      result.ok = false;
      result.url = { url, reachable: false, error: error.cause?.code || error.name || String(error) };
    }
  }
  for (const file of (args.state || []).filter((s) => typeof s === 'string')) {
    const path = resolve(file);
    if (!existsSync(path)) {
      result.ok = false;
      result.states.push({ file, exists: false });
      continue;
    }
    try {
      const state = readJson(path);
      const now = Date.now() / 1000;
      const cookies = state.cookies || [];
      const persistent = cookies.filter((c) => c.expires && c.expires > 0);
      const upcoming = persistent.filter((c) => c.expires >= now).map((c) => c.expires).sort((a, b) => a - b);
      result.states.push({
        file,
        exists: true,
        cookies: cookies.length,
        session_cookies: cookies.length - persistent.length,
        expired_cookies: persistent.length - upcoming.length,
        next_expiry: upcoming.length ? new Date(upcoming[0] * 1000).toISOString() : null,
        origins_with_storage: (state.origins || []).length,
        age_hours: Math.round((Date.now() - statSync(path).mtimeMs) / 36e5),
      });
    } catch {
      result.ok = false;
      result.states.push({ file, exists: true, error: 'not a valid storage state JSON file' });
    }
  }
  print(result);
}

// Run playwright-cli from the run directory, so relative --filename paths land in the run
// and sessions share the run's workspace. It exits 0 on errors, so errors are parsed from output.
function playwrightCli(runDir, cliArgs, timeout = 60000) {
  try {
    const out = execFileSync('playwright-cli', cliArgs, { cwd: runDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
    return { out: out.trim(), error: out.match(/### Error\s*\n(?:Error: )?(.+)/)?.[1] ?? null };
  } catch (err) {
    return { out: '', error: err.code === 'ENOENT' ? 'playwright-cli is not installed' : String(err.stderr || err.message).trim().split('\n')[0] };
  }
}

function pw(runDir, session, cliArgs, timeout = 60000) {
  const result = playwrightCli(runDir, [`-s=${session}`, ...cliArgs], timeout);
  return /is not open, please run open first/.test(result.out) ? { ...result, error: `browser session '${session}' is not open` } : result;
}

// The Playwright dashboard shows every playwright-cli session live, headless ones included,
// and lets a human take control. It runs as one daemon; another call focuses the session.
const openLiveView = (runDir, session) => playwrightCli(runDir, [...(session ? [`-s=${session}`] : []), 'show'], 90000);

const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const REDACTABLE_RESOURCE = /\.(json|html?|txt|xml)$/i;
// Request and response bodies are stored as .dat; redact the ones that are text
// (e.g. token endpoint responses) and leave binary ones untouched.
const isTextFile = (path) => {
  const head = readFileSync(path).subarray(0, 8192);
  return !head.includes(0);
};
const redactableResource = (path) => REDACTABLE_RESOURCE.test(path) || (/\.dat$/i.test(path) && isTextFile(path));

// Secrets that must not leave the machine inside evidence: session cookies and
// tokens from the roles' saved logins, plus sensitive header values seen on the wire.
function collectSecrets(runDir, networkText = '') {
  const secrets = new Set();
  const add = (value, min = 8) => {
    if (typeof value === 'string' && value.length >= min) secrets.add(value);
  };
  const envPath = join(runDir, 'env.json');
  try {
    for (const role of Object.values(existsSync(envPath) ? readJson(envPath).roles || {} : {})) {
      if (!role.state || !existsSync(role.state)) continue;
      const state = readJson(role.state);
      for (const c of state.cookies || []) add(c.value);
      for (const origin of state.origins || []) for (const item of origin.localStorage || []) add(item.value, 16);
    }
  } catch {
    // an unreadable state file just contributes no secrets
  }
  for (const line of networkText.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    for (const part of [event.snapshot?.request, event.snapshot?.response]) {
      for (const h of part?.headers || []) {
        if (!SENSITIVE_HEADERS.test(h.name)) continue;
        add(h.value);
        add(String(h.value).replace(/^(Bearer|Token|Basic)\s+/i, '')); // the bare token also appears in URLs
      }
      for (const c of part?.cookies || []) add(c.value);
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length);
}

// Pattern-based redaction catches what the known values miss: tokens the app
// refreshed during the run, and tokens passed in URLs (?token=…).
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const TOKEN_PARAM = /([?&](?:token|access_token|id_token|refresh_token|session|sid|api_key|apikey|auth)=)[^&\s"'\\]{8,}/gi;
const redact = (text, secrets) =>
  secrets
    .reduce((out, secret) => (out.includes(secret) ? out.split(secret).join('[REDACTED]') : out), text)
    .replace(JWT, '[REDACTED-JWT]')
    .replace(TOKEN_PARAM, '$1[REDACTED]');

// Package one playwright-cli trace (.trace/.network/.stacks + referenced resources)
// in the layout the Playwright trace viewer expects, with secrets redacted.
function packTrace(tracePath, caseDir, runDir) {
  const base = tracePath.replace(/\.trace$/, '');
  const stage = join(caseDir, '.trace-stage');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'resources'), { recursive: true });
  const sources = Object.fromEntries(
    ['trace', 'network', 'stacks'].filter((ext) => existsSync(`${base}.${ext}`)).map((ext) => [ext, readFileSync(`${base}.${ext}`, 'utf8')]),
  );
  const secrets = collectSecrets(runDir, sources.network || '');
  for (const [ext, content] of Object.entries(sources)) writeFileSync(join(stage, `trace.${ext}`), redact(content, secrets));
  const referenced = `${sources.trace || ''}${sources.network || ''}`;
  // resources/ holds network bodies and assets; screencast/ holds the screenshots
  // the trace references by relative path. Copy only what this trace references.
  for (const sub of ['resources', 'screencast']) {
    const dir = join(dirname(tracePath), sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!referenced.includes(name)) continue;
      const src = join(dir, name);
      const dest = join(stage, sub, name);
      mkdirSync(dirname(dest), { recursive: true });
      if (statSync(src).isFile() && redactableResource(src)) writeFileSync(dest, redact(readFileSync(src, 'utf8'), secrets));
      else cpSync(src, dest, { recursive: true });
    }
  }
  if (sh('which', ['zip'])) {
    const zipPath = join(caseDir, 'trace.zip');
    rmSync(zipPath, { force: true });
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: stage, stdio: 'ignore' });
    rmSync(stage, { recursive: true, force: true });
    return { path: zipPath };
  }
  const dir = join(caseDir, 'trace');
  rmSync(dir, { recursive: true, force: true });
  renameSync(stage, dir);
  return { path: dir, note: 'zip is not installed; zip this folder into trace.zip and open it with `qa-loop trace`' };
}

function requireCase(args) {
  // Real path: playwright-cli prints paths relative to the real cwd (e.g. /tmp -> /private/tmp).
  const runDir = realpathSync(requireRun(args));
  const id = safeId(args.case);
  const session = text(args.session);
  if (!id) fail('--case is required');
  const caseDir = join(runDir, 'evidence', id);
  mkdirSync(caseDir, { recursive: true });
  return { runDir, id, session, caseDir };
}

function begin(args) {
  const { runDir, id, session, caseDir } = requireCase(args);
  if (!session) fail('--session is required');
  const cleared = pw(runDir, session, ['--raw', 'console', '--clear']);
  if (cleared.error) fail(cleared.error, { hint: `open it first: cd "${runDir}" && playwright-cli -s=${session} open about:blank` });
  pw(runDir, session, ['--raw', 'requests', '--clear']);
  let started = pw(runDir, session, ['tracing-start']);
  if (started.error && /already/i.test(started.error)) {
    pw(runDir, session, ['tracing-stop']);
    started = pw(runDir, session, ['tracing-start']);
  }
  if (started.error) fail(`tracing-start failed: ${started.error}`);
  writeFileSync(join(caseDir, '.started'), String(Date.now()));
  print({ ok: true, case: id, session, evidence_dir: relative(runDir, caseDir), started_at: new Date().toISOString() });
}

const NOISE = /favicon\.ico/;

// Console messages, uncaught page errors and requests for the whole case, across
// navigations, read from the trace (playwright-cli's own lists cover only the current page).
function traceSignals(tracePath) {
  const parse = (path) =>
    existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').flatMap((line) => {
          try {
            return line ? [JSON.parse(line)] : [];
          } catch {
            return [];
          }
        })
      : [];
  const consoleLines = [];
  for (const e of parse(tracePath)) {
    if (e.type === 'console') {
      const where = e.location?.url ? ` @ ${e.location.url}:${e.location.lineNumber ?? 0}` : '';
      consoleLines.push(`[${String(e.messageType || 'log').toUpperCase()}] ${e.text}${where}`);
    } else if (e.type === 'event' && e.method === 'pageError') {
      const err = e.params?.error?.error || e.params?.error || {};
      consoleLines.push(`[PAGEERROR] ${err.stack || `${err.name || 'Error'}: ${err.message || ''}`}`);
    }
  }
  const requests = parse(tracePath.replace(/\.trace$/, '.network'))
    .filter((e) => e.type === 'resource-snapshot' && e.snapshot?.request && !e.snapshot.request.url.startsWith('data:'))
    .map(({ snapshot: s }) => `${s.request.method} ${s.request.url} => ${s.response?.status ?? '?'} ${s.response?.statusText ?? ''}`.trim());
  return { consoleLines, requests };
}

function summarizeSignals(consoleLines, requests) {
  const relevant = consoleLines.filter((l) => !NOISE.test(l));
  const errors = [...relevant.filter((l) => l.startsWith('[PAGEERROR]')), ...relevant.filter((l) => l.startsWith('[ERROR]'))];
  return {
    console: {
      errors: errors.length,
      warnings: relevant.filter((l) => l.startsWith('[WARNING]')).length,
      first_errors: errors.slice(0, 5).map((l) => l.split('\n')[0]),
    },
    failed_requests: requests.filter((l) => / => (?:[45]\d\d|-1|0|\?)(?:\s|$)/.test(l) && !NOISE.test(l)).slice(0, 20),
  };
}

function end(args) {
  const { runDir, id, session, caseDir } = requireCase(args);
  if (!session) fail('--session is required');
  const rel = (p) => relative(runDir, p);
  const files = [];
  const notes = [];

  if (!args['no-snapshot']) {
    const snapshot = pw(runDir, session, ['snapshot', `--filename=${rel(join(caseDir, 'dom.yml'))}`]);
    if (snapshot.error && /not open/.test(snapshot.error)) fail(snapshot.error, { hint: 'the browser session must stay open until `qa-loop end`' });
    if (!snapshot.error && existsSync(join(caseDir, 'dom.yml'))) files.push(rel(join(caseDir, 'dom.yml')));
    else notes.push(`DOM snapshot failed: ${snapshot.error}`);
  }

  let consoleLines;
  let requests;
  let secrets = collectSecrets(runDir);
  const stopped = pw(runDir, session, ['tracing-stop']);
  const traceLink = stopped.out.match(/\[Trace\]\(([^)]+)\)/)?.[1];
  if (stopped.error || !traceLink) {
    notes.push(`no trace: ${stopped.error || 'tracing-stop printed no trace path'} (start cases with qa-loop begin); console and network cover the current page only`);
    const consoleOut = pw(runDir, session, ['--raw', 'console', 'warning']);
    if (consoleOut.error) fail(consoleOut.error, { hint: 'the browser session must stay open until `qa-loop end`' });
    consoleLines = consoleOut.out.split('\n').filter((l) => /^\[/.test(l) || /^\w*Error\b/.test(l)).map((l) => (/^\[/.test(l) ? l : `[PAGEERROR] ${l}`));
    requests = pw(runDir, session, ['--raw', 'requests']).out.split('\n').filter(Boolean).map((l) => l.replace(/^\d+\.\s*\[(\w+)\]\s*/, '$1 ').replace(/=> \[(\d+)\]/, '=> $1'));
  } else {
    const tracePath = resolve(runDir, traceLink);
    ({ consoleLines, requests } = traceSignals(tracePath));
    const networkPath = tracePath.replace(/\.trace$/, '.network');
    secrets = collectSecrets(runDir, existsSync(networkPath) ? readFileSync(networkPath, 'utf8') : '');
    const packed = packTrace(tracePath, caseDir, runDir);
    files.push(rel(packed.path));
    if (packed.note) notes.push(packed.note);
  }
  // A replay video the tester left running is finalized here (an error just means none was running).
  pw(runDir, session, ['video-stop']);

  writeFileSync(join(caseDir, 'console.txt'), `${redact(consoleLines.join('\n'), secrets) || '(no console messages)'}\n`);
  writeFileSync(join(caseDir, 'network.txt'), `${redact(requests.join('\n'), secrets) || '(no requests)'}\n`);
  files.push(rel(join(caseDir, 'console.txt')), rel(join(caseDir, 'network.txt')));

  const startedFile = join(caseDir, '.started');
  const duration = existsSync(startedFile) ? Math.round((Date.now() - Number(readFileSync(startedFile, 'utf8'))) / 1000) : null;
  const media = readdirSync(caseDir).filter((n) => /\.(png|jpe?g|webp|webm)$/i.test(n)).sort().map((n) => rel(join(caseDir, n)));
  print({ ok: true, case: id, files: [...media, ...files], ...summarizeSignals(consoleLines, requests), duration_s: duration, notes });
}

function evidence(args) {
  const runDir = requireRun(args);
  const id = safeId(args.case);
  if (!id) fail('--case is required');
  const traces = join(runDir, '.playwright-cli', 'traces');
  const latest = existsSync(traces)
    ? readdirSync(traces)
        .filter((n) => n.endsWith('.trace'))
        .map((n) => ({ name: n, mtime: statSync(join(traces, n)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0]
    : null;
  if (!latest) fail('no .trace file found: open the session from the run directory and use tracing-start / tracing-stop', { traces });
  const caseDir = join(runDir, 'evidence', id);
  mkdirSync(caseDir, { recursive: true });
  const packed = packTrace(join(traces, latest.name), caseDir, runDir);
  const rel = relative(runDir, packed.path);
  print({ ok: true, case: id, trace: rel, source: latest.name, note: packed.note ?? null, view: `qa-loop trace "${packed.path}"` });
}

// Re-apply redaction to everything already in evidence/ (text files and trace zips),
// e.g. after a redaction rule improved or when the tester saved files itself.
const REDACTABLE_TEXT = /\.(txt|json|ya?ml|md|js|log|html?|xml|csv|trace|network)$/i;
const traceFile = (rel, full) => /(^|\/)trace\.(trace|network)$/i.test(rel) || (/(^|\/)resources\//.test(rel) && redactableResource(full));

function redactEvidence(runDir) {
  if (!sh('which', ['zip']) || !sh('which', ['unzip'])) return { skipped: 'zip and unzip are required' };
  const baseSecrets = collectSecrets(runDir);
  const changed = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (REDACTABLE_TEXT.test(name) || (/\.dat$/i.test(name) && isTextFile(path))) {
        const before = readFileSync(path, 'utf8');
        const after = redact(before, baseSecrets);
        if (after !== before) {
          writeFileSync(path, after);
          changed.push(relative(runDir, path));
        }
      } else if (/\.zip$/i.test(name)) {
        const tmp = join(dirname(path), `.redact-${basename(name, '.zip')}`);
        rmSync(tmp, { recursive: true, force: true });
        execFileSync('unzip', ['-q', '-o', path, '-d', tmp]);
        const network = existsSync(join(tmp, 'trace.network')) ? readFileSync(join(tmp, 'trace.network'), 'utf8') : '';
        const secrets = collectSecrets(runDir, network);
        let touched = false;
        const inner = (d) => {
          for (const n of readdirSync(d)) {
            const p = join(d, n);
            if (statSync(p).isDirectory()) inner(p);
            else if (traceFile(relative(tmp, p), p)) {
              const before = readFileSync(p, 'utf8');
              const after = redact(before, secrets);
              if (after !== before) {
                writeFileSync(p, after);
                touched = true;
              }
            }
          }
        };
        inner(tmp);
        if (touched) {
          rmSync(path, { force: true });
          execFileSync('zip', ['-qr', path, '.'], { cwd: tmp, stdio: 'ignore' });
          changed.push(relative(runDir, path));
        }
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  };
  // evidence/ is what people share; .playwright-cli/ holds playwright-cli's raw working files.
  for (const sub of ['evidence', '.playwright-cli']) if (existsSync(join(runDir, sub))) walk(join(runDir, sub));
  return { redacted_files: changed.length, files: changed };
}

function redactRun(args) {
  const runDir = requireRun(args);
  print({ ok: true, ...redactEvidence(runDir) });
}

function loadJson(path, issues, label) {
  if (!existsSync(path)) {
    issues.push(`${label}: missing`);
    return null;
  }
  try {
    return readJson(path);
  } catch (error) {
    issues.push(`${label}: invalid JSON (${error.message})`);
    return null;
  }
}

function validate(runDir) {
  const issues = [];
  const plan = loadJson(join(runDir, 'plan.json'), issues, 'plan.json');
  const results = loadJson(join(runDir, 'results.json'), issues, 'results.json');
  const exists = (p) => {
    const full = isAbsolute(p) ? p : join(runDir, p);
    return existsSync(full) && statSync(full).isFile() && statSync(full).size > 0;
  };

  if (plan) {
    if (!Array.isArray(plan.cases) || !plan.cases.length) issues.push('plan.json: cases must be a non-empty array');
    const ids = new Set();
    for (const c of plan.cases || []) {
      if (!text(c.id)) issues.push('plan.json: a case has no id');
      else if (ids.has(c.id)) issues.push(`plan.json: duplicate case id ${c.id}`);
      ids.add(c.id);
      if (!LEVELS.includes(c.level)) issues.push(`plan.json ${c.id}: level must be one of ${LEVELS.join(', ')}`);
      if (!text(c.title)) issues.push(`plan.json ${c.id}: title is required`);
      if (c.level === 'acceptance' && !text(c.expected)) issues.push(`plan.json ${c.id}: acceptance cases need an explicit expected result`);
      if (c.surface && !SURFACES.includes(c.surface)) issues.push(`plan.json ${c.id}: surface must be one of ${SURFACES.join(', ')}`);
      if (c.mutations !== undefined && !(Array.isArray(c.mutations) && c.mutations.every(text))) issues.push(`plan.json ${c.id}: mutations must be a list of descriptions`);
    }
    if (!(plan.cases || []).some((c) => c.level === 'acceptance')) issues.push('plan.json: no acceptance cases');
  }

  if (results) {
    const planned = new Set((plan?.cases || []).map((c) => c.id));
    const seen = new Set();
    for (const c of results.cases || []) {
      const where = `results.json ${c.id || '?'}`;
      if (!text(c.id)) issues.push('results.json: a case has no id');
      seen.add(c.id);
      if (!CASE_STATUSES.includes(c.status)) issues.push(`${where}: status must be one of ${CASE_STATUSES.join(', ')}`);
      if (c.level && !LEVELS.includes(c.level)) issues.push(`${where}: unknown level ${c.level}`);
      if (!planned.has(c.id) && !c.level) issues.push(`${where}: unplanned case needs a level`);
      const evidenceList = c.evidence || [];
      for (const e of evidenceList) if (!exists(e)) issues.push(`${where}: evidence file missing or empty: ${e}`);
      if (c.status === 'PASS' && !text(c.assertion)) issues.push(`${where}: PASS needs an assertion (what was checked and the value seen)`);
      if (['PASS', 'FAIL'].includes(c.status) && !evidenceList.some(exists)) issues.push(`${where}: ${c.status} needs at least one evidence file`);
      if (c.status === 'FAIL' && (Number(c.reproductions) || 0) < 2) issues.push(`${where}: FAIL needs reproductions >= 2 (replay from a clean state), otherwise use FLAKY`);
      if (['FAIL', 'FLAKY'].includes(c.status) && (!text(c.expected) || !text(c.actual))) issues.push(`${where}: ${c.status} needs expected and actual`);
      if (['BLOCKED', 'NOT_RUN', 'INCONCLUSIVE'].includes(c.status) && !text(c.blocked_reason)) issues.push(`${where}: ${c.status} needs blocked_reason`);
      if (c.repro && !exists(c.repro)) issues.push(`${where}: repro file missing or empty: ${c.repro}`);
      if (c.assisted !== undefined && !text(c.assisted)) issues.push(`${where}: assisted must say what the human did`);
      if (c.human_steps && !text(c.assisted)) issues.push(`${where}: human_steps needs assisted (what the human did)`);
      if (c.human_steps && !exists(c.human_steps)) issues.push(`${where}: human_steps file missing or empty: ${c.human_steps}`);
    }
    if (results.created_data !== undefined && !(Array.isArray(results.created_data) && results.created_data.every(text))) {
      issues.push('results.json: created_data must be a list of descriptions');
    }
    for (const id of planned) if (!seen.has(id)) issues.push(`results.json: no result for planned case ${id}`);
    const findingIds = new Set();
    for (const f of results.findings || []) {
      const where = `results.json finding ${f.id || '?'}`;
      if (!text(f.id)) issues.push('results.json: a finding has no id');
      else if (findingIds.has(f.id)) issues.push(`results.json: duplicate finding id ${f.id}`);
      findingIds.add(f.id);
      if (!['BUG', 'QUESTION'].includes(f.type)) issues.push(`${where}: type must be BUG or QUESTION`);
      if (f.type === 'BUG' && !SEVERITIES.includes(f.severity)) issues.push(`${where}: BUG needs severity (${SEVERITIES.join(', ')})`);
      if (!['yes', 'no', 'unknown'].includes(f.related_to_change)) issues.push(`${where}: related_to_change must be yes, no or unknown`);
      if (!text(f.title) || !text(f.actual)) issues.push(`${where}: title and actual are required`);
      if (!(f.steps || []).length) issues.push(`${where}: steps are required`);
      for (const e of f.evidence || []) if (!exists(e)) issues.push(`${where}: evidence file missing or empty: ${e}`);
      if (f.type === 'BUG' && !(f.evidence || []).some(exists)) issues.push(`${where}: BUG needs at least one evidence file`);
      if (f.category && !CATEGORIES.includes(f.category)) issues.push(`${where}: category must be one of ${CATEGORIES.join(', ')}`);
      if (f.repro && !exists(f.repro)) issues.push(`${where}: repro file missing or empty: ${f.repro}`);
    }
  }
  return { plan, results, issues };
}

// Errors seen across all cases, deduplicated by message (gstack's "console health").
function consoleHealth(runDir) {
  const evidenceDir = join(runDir, 'evidence');
  if (!existsSync(evidenceDir)) return [];
  const byMessage = new Map();
  for (const id of readdirSync(evidenceDir).sort()) {
    const file = join(evidenceDir, id, 'console.txt');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/^\[(PAGEERROR|ERROR)\]/.test(line) || NOISE.test(line)) continue;
      const message = line.replace(/ @ \S+$/, '').slice(0, 200);
      const entry = byMessage.get(message) || { message, count: 0, cases: [] };
      entry.count++;
      if (!entry.cases.includes(id)) entry.cases.push(id);
      byMessage.set(message, entry);
    }
  }
  return [...byMessage.values()].sort((a, b) => b.count - a.count).slice(0, 15);
}

function check(args) {
  const runDir = requireRun(args);
  const { issues } = validate(runDir);
  print({ ok: issues.length === 0, issues });
}

function verdict(args) {
  const runDir = requireRun(args);
  const run = readJson(join(runDir, 'run.json'));
  const { plan, results, issues } = validate(runDir);
  if (!plan) fail('plan.json is missing or invalid', { issues });
  const decisionsPath = join(runDir, 'decisions.json');
  const decisions = existsSync(decisionsPath) ? readJson(decisionsPath) : {};
  const fileExists = (p) => {
    const full = isAbsolute(p) ? p : join(runDir, p);
    return existsSync(full) && statSync(full).isFile() && statSync(full).size > 0;
  };
  const res = results || { cases: [], findings: [] };
  const redaction = redactEvidence(runDir); // defense in depth: the tester may have saved files itself
  const normalized = normalize({ plan, results: res, decisions, fileExists });
  const outcome = computeVerdict(normalized);
  const lang = run.lang || 'en';
  const started = Date.parse(res.started_at || '');
  const finished = Date.parse(res.finished_at || '');
  const core = bundledPlaywrightCore();
  const runForReport = {
    ...run,
    run_dir: runDir,
    duration_min: started && finished ? Math.max(1, Math.round((finished - started) / 60000)) : null,
    trace_viewer: core ? `node "${core}" show-trace` : null,
  };
  const input = { lang, run: runForReport, plan, normalized, verdict: outcome, results: res, consoleHealth: consoleHealth(runDir) };
  writeFileSync(join(runDir, 'report.md'), renderReport(input));
  writeFileSync(join(runDir, 'jira-comment.md'), renderJiraComment(input));
  // A final verdict ends the run and the code freeze; NEEDS_DECISION keeps both open
  // until the human's decisions are recorded (or `qa-loop run close`).
  const qaDir = dirname(dirname(dirname(runDir)));
  if (basename(qaDir) === '.qa' && outcome.verdict !== 'NEEDS_DECISION') closeActive(qaDir, runDir);

  const acceptance = normalized.cases.filter((c) => c.level === 'acceptance');
  const summary = {
    verdict: outcome.verdict,
    reason: reasonLine(lang, outcome.reasons),
    reasons: outcome.reasons,
    acceptance: countBy(acceptance, 'status'),
    other: countBy(normalized.cases.filter((c) => c.level !== 'acceptance'), 'status'),
    findings: normalized.findings.map((f) => ({ id: f.id, type: f.type, severity: f.severity, state: f.state, confirmed: f.confirmed, related_to_change: f.related_to_change, title: f.title })),
    problems: normalized.problems,
    validation_issues: issues,
    redaction,
    report: join(runDir, 'report.md'),
    jira_comment: join(runDir, 'jira-comment.md'),
  };
  writeJson(join(runDir, 'verdict.json'), {
    ...summary,
    computed_at: new Date().toISOString(),
    cases: normalized.cases.map((c) => ({ id: c.id, level: c.level, status: c.status, status_reason: c.status_reason })),
  });
  print({ ok: true, ...summary });
}

function watch(args) {
  const runDir = realpathSync(requireRun(args));
  if (args.stop) {
    const closed = playwrightCli(runDir, ['show', '--kill']);
    print({ ok: !closed.error, live_view: closed.error ? null : 'closed', error: closed.error });
    return;
  }
  const opened = openLiveView(runDir, text(args.session));
  if (opened.error) fail(`the live view did not open: ${opened.error}`, { hint: 'it needs a desktop session; the run works the same without it' });
  print({ ok: true, live_view: 'open', session: text(args.session) });
}

// A human acts in the tester's browser session (an SMS code, a CAPTCHA, a state the tester
// can't reach). Their actions are recorded and saved as a replayable script, secrets masked.
function assist(args) {
  const action = args._[0];
  if (!['start', 'stop'].includes(action)) fail('usage: qa-loop assist start|stop --run DIR --case ID --session NAME');
  const { runDir, id, session, caseDir } = requireCase(args);
  if (!session) fail('--session is required');
  const startedFile = join(caseDir, '.assist-started');

  if (action === 'start') {
    const started = pw(runDir, session, ['recording-start']);
    if (started.error) fail(started.error, { hint: 'the tester keeps its session open while it waits for help' });
    writeFileSync(startedFile, String(Date.now()));
    const view = openLiveView(runDir, session);
    print({ ok: true, case: id, session, recording: true, live_view: view.error ? null : 'open', live_view_error: view.error });
    return;
  }

  const stopped = pw(runDir, session, ['recording-stop']);
  if (stopped.error) fail(stopped.error);
  const recorded = parseRecording(stopped.out);
  const masked = maskSecretFields(recorded.lines);
  const secrets = collectSecrets(runDir);
  const steps = masked.lines.map((line) => redact(line, secrets));
  let file = null;
  if (steps.length) {
    file = join(caseDir, 'human-steps.js');
    for (let n = 2; existsSync(file); n++) file = join(caseDir, `human-steps-${n}.js`);
    writeFileSync(file, stepsScript(steps, { caseId: id, at: new Date().toISOString() }));
  }
  const duration = existsSync(startedFile) ? Math.round((Date.now() - Number(readFileSync(startedFile, 'utf8'))) / 1000) : null;
  rmSync(startedFile, { force: true });
  print({
    ok: true, case: id, session, actions: steps.length, masked: masked.masked, duration_s: duration,
    human_steps: file && relative(runDir, file), page_url: recorded.url && redact(recorded.url, secrets), steps,
  });
}

function trace(args) {
  const path = args._[0] && resolve(args._[0]);
  if (!path || !existsSync(path)) fail('usage: qa-loop trace <path to trace.zip>');
  const core = bundledPlaywrightCore();
  if (!core) fail('playwright-cli is not installed (npm install -g @playwright/cli@latest)');
  const extra = text(args.port) ? ['--port', args.port] : [];
  execFileSync('node', [core, 'show-trace', ...extra, path], { stdio: 'inherit' });
}

// --- main -------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const commands = {
  preflight: () => preflight(args),
  run: () => (args._[0] === 'new' ? runNew(args) : args._[0] === 'close' ? runClose(args) : fail('usage: qa-loop run new --ticket KEY | qa-loop run close')),
  context: () => context(args),
  env: () => env(args),
  begin: () => begin(args),
  end: () => end(args),
  watch: () => watch(args),
  assist: () => assist(args),
  evidence: () => evidence(args),
  check: () => check(args),
  verdict: () => verdict(args),
  redact: () => redactRun(args),
  trace: () => trace(args),
};

if (!command || command === '--help' || command === 'help' || !commands[command]) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(command && !['--help', 'help'].includes(command) ? 1 : 0);
}
await commands[command]();
