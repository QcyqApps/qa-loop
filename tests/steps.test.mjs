import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecretFields, parseRecording, stepsScript } from '../scripts/lib/steps.mjs';

// What `playwright-cli recording-stop` prints (0.1.22).
const RECORDING = [
  '### Result',
  'Recording stopped. Recorded actions:',
  '',
  '```js',
  "await page.goto('http://localhost:4317/login');",
  "await page.getByRole('textbox', { name: 'Username' }).fill('admin');",
  "await page.getByRole('textbox', { name: 'Password' }).fill('demo');",
  "await page.getByRole('button', { name: 'Sign in' }).click();",
  '```',
  '### Page',
  '- Page URL: http://localhost:4317/users?status=all',
  '- Page Title: Users — Demo CP',
].join('\n');

test('a recording is parsed into steps and the page it ended on', () => {
  const { lines, url } = parseRecording(RECORDING);
  assert.equal(lines.length, 4);
  assert.equal(url, 'http://localhost:4317/users?status=all');
  assert.deepEqual(parseRecording('### Result\nRecording stopped. Recorded actions:\n'), { lines: [], url: null });
});

test('values typed into secret-looking fields are masked; other steps stay replayable', () => {
  const { lines, masked } = maskSecretFields([
    ...parseRecording(RECORDING).lines,
    "await page.getByLabel('Hasło').fill('tajne');",
    "await page.getByPlaceholder('Kod SMS').pressSequentially('123456');",
    "await page.locator('#pw').type('x\\'y');",
    "await page.getByLabel('PIN').press('7');",
    "await page.getByLabel('Password').press('Enter');",
    "await page.getByLabel('Postal code').fill('00-001');",
  ]);
  assert.equal(masked, 5);
  const code = lines.join('\n');
  for (const typed of ["'demo'", "'tajne'", "'123456'", "y'", "'7'"]) assert.ok(!code.includes(typed), `${typed} must be masked`);
  assert.match(code, /name: 'Username' \}\)\.fill\('admin'\)/);
  assert.match(code, /press\('Enter'\)/);
  assert.match(code, /fill\('00-001'\)/);
});

test('the saved steps are a run-code function', () => {
  const script = stepsScript(["await page.goto('http://localhost:4317/users');"], { caseId: 'AC-3', at: '2026-10-07T12:00:00Z' });
  assert.match(script, /^async page => \{/);
  assert.match(script, /AC-3/);
  new Function(`return (${script})`);
});
