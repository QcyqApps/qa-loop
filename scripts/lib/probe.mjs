// Reachability of the app under test: one request to its base URL. Redirects aren't
// followed and the response body isn't read; only the status and the redirect target count.
export async function probeUrl(url, timeoutMs = 10000) {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { url, reachable: true, status: res.status, location: res.headers.get('location'), ms: Date.now() - started };
  } catch (error) {
    return { url, reachable: false, error: error.cause?.code || error.name || String(error) };
  }
}
