// Localhost hook listener. SAFETY INVARIANT: the 200 {} response is written
// before ANY payload inspection — this server can never emit hookSpecificOutput,
// permissionDecision, continue, or added context, so a pet bug can never alter
// a Claude Code session.
import * as http from 'node:http';
import type { PetState } from './state.js';

const MAX_BODY = 256 * 1024; // PostToolUseFailure can carry a huge tool_error

function collectBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
      // over the cap: keep draining so the socket closes cleanly, keep what we have
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

// Whitelist the fields we read; everything else in the payload is ignored.
function normalize(payload: unknown): PetEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.hook_event_name !== 'string') return null;
  return {
    event: p.hook_event_name,
    session_id: typeof p.session_id === 'string' ? p.session_id : 'unknown',
    cwd: typeof p.cwd === 'string' ? p.cwd : '',
    tool_name: typeof p.tool_name === 'string' ? p.tool_name : null,
    notification_type: typeof p.notification_type === 'string' ? p.notification_type : null,
  };
}

export interface HookServerOptions {
  port: number;
  state: PetState;
  onTestState?: ((state: string) => void) | null;
  onSnapshot?: ((index: number) => Promise<Buffer>) | null;
  onWander?: (() => void) | null;
}

export function startHookServer({ port, state, onTestState = null, onSnapshot = null, onWander = null }: HookServerOptions): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/snapshot') && onSnapshot) {
      // debug: PNG of a pet window (?i=N for the Nth pet, 0 = primary)
      const idx = parseInt(new URL(req.url, 'http://localhost').searchParams.get('i') || '0', 10) || 0;
      onSnapshot(idx).then(
        (png) => {
          res.writeHead(200, { 'content-type': 'image/png' });
          res.end(png);
        },
        () => {
          res.writeHead(500);
          res.end();
        }
      );
      return;
    }
    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.debugInfo(), null, 2));
      return;
    }

    // Everything else: answer immediately, inspect later. One response path.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');

    if (req.method !== 'POST') return;
    collectBody(req, MAX_BODY).then((raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return; // parse failures are swallowed — cosmetic app
      }
      if (req.url === '/hook') {
        const evt = normalize(payload);
        if (evt) state.applyEvent(evt);
      } else if (req.url === '/test-state' && onTestState && payload && typeof payload === 'object') {
        const s = (payload as Record<string, unknown>).state;
        if (typeof s === 'string') onTestState(s);
      } else if (req.url === '/wander' && onWander) {
        onWander();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
