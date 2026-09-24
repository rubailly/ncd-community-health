// A local stand-in for the WhatsApp Cloud API (Meta Graph API).
//
//   POST   /:version/:phoneNumberId/messages   send a template message
//   GET    /messages[?to=250788100001]         messages received so far (JSON)
//   DELETE /messages                           forget all messages
//   GET    /                                   the same messages, as a page
//   GET    /health                             liveness probe
//
// Like Meta, it rejects unknown templates, wrong parameter counts and
// requests without a bearer token, so integration mistakes surface locally.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 9000);

// Template name -> number of body parameters it expects
const TEMPLATES = {
  ncd_referral_hc_notify: 7,
  ncd_referral_patient_notify: 3,
};

const messages = [];

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function graphError(res, status, message, code = 100) {
  send(res, status, { error: { message, type: 'OAuthException', code, fbtrace_id: randomUUID() } });
}

function validate(payload) {
  if (payload?.messaging_product !== 'whatsapp') return 'messaging_product must be "whatsapp"';
  if (!/^\d{8,15}$/.test(payload.to || '')) return '"to" must be an international number, digits only';
  if (payload.type !== 'template') return 'only template messages are supported';
  const name = payload.template?.name;
  if (!(name in TEMPLATES)) return `template "${name}" does not exist`;
  const body = (payload.template.components || []).find(c => c.type === 'body');
  const count = body?.parameters?.length ?? 0;
  if (count !== TEMPLATES[name]) return `template "${name}" expects ${TEMPLATES[name]} body parameters, got ${count}`;
  if (body.parameters.some(p => p.type !== 'text' || !String(p.text ?? '').trim())) {
    return 'every body parameter must be non-empty text';
  }
  return null;
}

function page() {
  const rows = messages
    .slice()
    .reverse()
    .map(m => {
      const body = m.payload.template.components.find(c => c.type === 'body');
      const params = body.parameters.map(p => escape(p.text)).join(' · ');
      return `<tr><td>${m.receivedAt}</td><td>+${m.payload.to}</td><td>${m.payload.template.name}</td><td>${params}</td></tr>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>WhatsApp mock</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top}</style>
<h1>WhatsApp mock</h1><p>${messages.length} message(s) received.</p>
<table><tr><th>Received</th><th>To</th><th>Template</th><th>Parameters</th></tr>${rows}</table>`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page(), 'text/html');
  if (req.method === 'GET' && url.pathname === '/messages') {
    const to = url.searchParams.get('to');
    return send(res, 200, messages.filter(m => !to || m.payload.to === to.replace(/\D/g, '')));
  }
  if (req.method === 'DELETE' && url.pathname === '/messages') {
    messages.length = 0;
    return send(res, 204, '');
  }

  const match = url.pathname.match(/^\/v\d+\.\d+\/([^/]+)\/messages$/);
  if (req.method === 'POST' && match) {
    if (!/^Bearer \S+/.test(req.headers.authorization || '')) {
      return graphError(res, 401, 'Missing bearer token', 190);
    }
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return graphError(res, 400, 'Request body is not valid JSON');
      }
      const problem = validate(payload);
      if (problem) return graphError(res, 400, problem, 132000);

      const id = `wamid.${randomUUID()}`;
      messages.push({ id, phoneNumberId: match[1], receivedAt: new Date().toISOString(), payload });
      console.log(`${payload.template.name} -> +${payload.to}`);
      send(res, 200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: payload.to, wa_id: payload.to }],
        messages: [{ id }],
      });
    });
    return;
  }

  graphError(res, 404, `Unknown path ${req.method} ${url.pathname}`, 803);
}).listen(PORT, () => console.log(`WhatsApp mock listening on :${PORT}`));
