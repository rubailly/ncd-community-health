// A small, strict HTTP client: non-2xx responses throw with the response
// body attached, so no failure can pass silently.

export class HttpError extends Error {
  constructor(method, url, status, body) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    super(`${method} ${url} -> ${status}: ${detail.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

export const basicAuth = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

export async function request(method, url, { headers = {}, query, body, form, timeout = 60_000, ok } = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query || {})) {
    for (const item of [].concat(value)) target.searchParams.append(key, item);
  }

  const init = { method, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) };
  if (form) {
    init.body = new URLSearchParams(form);
  } else if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] ??= 'application/json';
  }

  const response = await fetch(target, init);
  const text = await response.text();
  let data = text;
  if ((response.headers.get('content-type') || '').includes('json') && text) {
    try {
      data = JSON.parse(text);
    } catch {
      // keep the raw text
    }
  }

  const accepted = ok ? ok(response.status) : response.ok;
  if (!accepted) throw new HttpError(method, target.href, response.status, data);
  return { status: response.status, headers: response.headers, data };
}

// Resolves once check() returns a truthy value; retries on errors until timeout
export async function waitFor(label, check, { timeout = 600_000, interval = 5_000 } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
