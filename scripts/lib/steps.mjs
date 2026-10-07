// Steps a human performs in the tester's browser session while helping it (qa-loop assist).
// playwright-cli records them (`recording-start` / `recording-stop`) as Playwright code,
// and they are saved as a run-code script the tester can replay.

// Values typed into fields that look like secrets are masked before anything is saved.
const SECRET_FIELD = /pass|hasł|hasl|kennwort|\bpwd?\b|secret|token|\bpin\b|\botp\b|one[- ]?time|\b2fa\b|\bmfa\b|\btotp\b|\bcv[vc]\b|verification|weryfik|autoryz|\bsms\b/i;
const TYPED = /^(.*?\.(fill|type|pressSequentially|press)\()(['"`])((?:\\.|(?!\3).)*)\3(.*)$/;

export function parseRecording(output) {
  const code = String(output || '').match(/```js\n([\s\S]*?)```/)?.[1] ?? '';
  return {
    lines: code.split('\n').map((line) => line.trim()).filter(Boolean),
    url: String(output || '').match(/- Page URL: (\S+)/)?.[1] ?? null,
  };
}

export function maskSecretFields(lines) {
  let masked = 0;
  const out = lines.map((line) => {
    const m = line.match(TYPED);
    if (!m || !SECRET_FIELD.test(m[1])) return line;
    if (m[2] === 'press' && m[4].length > 1) return line; // named keys such as Enter are not secrets
    masked++;
    return `${m[1]}'[REDACTED]'${m[5]}`;
  });
  return { lines: out, masked };
}

export function stepsScript(lines, { caseId, at }) {
  return [
    'async page => {',
    `  // Steps a human performed for ${caseId} during qa-loop assist, recorded ${at}. Masked values read [REDACTED].`,
    ...lines.map((line) => `  ${line}`),
    '  return { url: page.url() };',
    '}',
    '',
  ].join('\n');
}
