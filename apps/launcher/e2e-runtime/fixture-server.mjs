import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// Deterministic loopback provider for exercising the desktop's RPC path.
// It is test-only: no network, no credentials, no runtime patch.
export function startFixtureServer(port = 0) {
  const requests = [];
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 2_000_000) request.destroy(); });
    request.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const lastUser = [...messages].reverse().find(message => message.role === 'user');
      const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
      requests.push({ model: data.model, text });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const chunk = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'deterministic', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: 'assistant' });
      if (text.includes('SLOW')) {
        chunk({ content: 'waiting-for-steer' });
        setTimeout(() => {
          chunk({ content: 'slow finished' });
          chunk({}, 'stop');
          response.end('data: [DONE]\n\n');
        }, 2500);
        return;
      }
      if (text.includes('ABORT')) {
        chunk({ content: 'waiting-for-abort' });
        const timer = setInterval(() => { if (!response.destroyed) response.write(': keep-alive\n\n'); }, 1000);
        request.on('close', () => clearInterval(timer));
        return;
      }
      if (text.includes('TOOL') && !messages.some(message => message.role === 'tool')) {
        chunk({ tool_calls: [{ index: 0, id: 'fixture-call-1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: process.env.JOUZU_FIXTURE_FILE ?? 'README.md' }) } }] });
        chunk({}, 'tool_calls');
        response.end('data: [DONE]\n\n');
        return;
      }
      chunk({ content: messages.some(message => message.role === 'tool') ? 'tool finished' : `fixture reply: ${text}` });
      chunk({}, 'stop');
      response.end('data: [DONE]\n\n');
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, requests, port: server.address().port })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startFixtureServer(Number(process.env.JOUZU_FIXTURE_PORT ?? 43123));
  console.log(port);
}
