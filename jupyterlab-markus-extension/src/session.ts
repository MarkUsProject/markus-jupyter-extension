import { PageConfig } from '@jupyterlab/coreutils';

import type { IMarkUsMetadata } from './jupyterlab-markus-extension';

// An error thrown by a MarkUs HTTP call, carrying the response status so
// callers can distinguish retryable failures (401) from everything else.
export class MarkUsServerError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'MarkUsServerError';
  }
}

// The authenticate response
interface ISessionResponse {
  status: string;
  session_token?: string;
  expires_at?: string;
  markus_user_name?: string;
  message?: string;
}

// Read a Jupyter base_url/token pair from PageConfig.
export function getJupyterCredentials(): { base_url: string; token: string } {
  const jupyterBaseUrl = PageConfig.getBaseUrl();
  const jupyterToken = PageConfig.getToken();

  if (!jupyterToken) {
    throw new Error(
      'No Jupyter token available. This environment may be using cookie/OAuth authentication. Token-based pull may not work.'
    );
  }

  return { base_url: jupyterBaseUrl, token: jupyterToken };
}

// Extract a human-readable message from a MarkUs error response body,
// which is JSON of the form {status, message, error_class}.
export function extractErrorMessage(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    // Not JSON -- fall through to using the raw text below.
  }

  return text || `HTTP ${status}`;
}

// Authenticate with the MarkUs server to obtain a short-lived session token
export async function authenticateWithMarkUs(markus: IMarkUsMetadata): Promise<ISessionResponse> {
  const authUrl = new URL('jupyter/authenticate', markus.url).toString();

  const response = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ jupyter: getJupyterCredentials() })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new MarkUsServerError(
      `MarkUs server error ${response.status}: ${extractErrorMessage(response.status, text)}`,
      response.status
    );
  }

  return JSON.parse(text) as ISessionResponse;
}

// Cache of live session tokens, keyed by MarkUs origin. A single JupyterLab
// install could submit to more than one trusted MarkUs deployment, each needing
// its own session.
interface ISessionCacheEntry {
  sessionToken: string;
  expiresAt: number; // epoch ms
}

const sessionCache = new Map<string, ISessionCacheEntry>();

// Don't reuse a token expiring within this margin, to avoid a race where it
// expires mid-request.
const SESSION_EXPIRY_SAFETY_MARGIN_MS = 30_000;

function getMarkusOrigin(markus: IMarkUsMetadata): string {
  return new URL(markus.url).origin;
}

// Drop any cached session for this MarkUs origin, forcing the next
// getOrCreateSession call to re-authenticate.
export function invalidateSession(markus: IMarkUsMetadata): void {
  sessionCache.delete(getMarkusOrigin(markus));
}

// Return a live session token for this MarkUs origin, reusing a cached one
// if it isn't close to expiring, otherwise authenticating for a fresh one.
export async function getOrCreateSession(markus: IMarkUsMetadata): Promise<string> {
  const origin = getMarkusOrigin(markus);
  const cached = sessionCache.get(origin);

  if (cached && cached.expiresAt - SESSION_EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return cached.sessionToken;
  }

  const response = await authenticateWithMarkUs(markus);

  if (!response.session_token || !response.expires_at) {
    throw new Error('MarkUs authentication response is missing "session_token" or "expires_at".');
  }

  const expiresAt = Date.parse(response.expires_at);

  if (Number.isNaN(expiresAt)) {
    throw new Error(`MarkUs authentication response has an invalid "expires_at" value: "${response.expires_at}".`);
  }

  sessionCache.set(origin, { sessionToken: response.session_token, expiresAt });

  return response.session_token;
}
