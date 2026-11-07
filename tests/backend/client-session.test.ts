import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, setCsrf } from '../../client/src/api.js';

test('a superseded session 401 cannot expire the current session', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  let expirations = 0;
  events.addEventListener('session-expired', () => expirations++);
  Object.defineProperty(globalThis, 'window', { value: events, configurable: true });
  let respond!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { respond = resolve; })) as typeof fetch;
  try {
    setCsrf('session-A');
    const old = api('/conversations/old/messages', { method: 'POST', body: { text: 'old' }, key: 'same-key' });
    const rejected = assert.rejects(old, ApiError);
    setCsrf('');
    setCsrf('session-B');
    respond(new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }));
    await rejected;
    assert.equal(expirations, 0);
    const current = api('/auth/me');
    const currentRejected = assert.rejects(current, ApiError);
    respond(new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }));
    await currentRejected;
    assert.equal(expirations, 1);
    const login = api('/auth/login', { method: 'POST', body: {} });
    const loginRejected = assert.rejects(login, ApiError);
    respond(new Response(JSON.stringify({ error: { message: 'invalid' } }), { status: 401 }));
    await loginRejected;
    assert.equal(expirations, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    setCsrf('');
  }
});
