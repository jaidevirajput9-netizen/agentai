const express = require('express');
const path = require('path');
require('dotenv').config();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '32kb' }));

// Small in-memory rate limit for the prototype. Use a shared store for scaled production.
const hits = new Map();
app.use('/api/', (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const current = hits.get(key);
  if (!current || now - current.start >= windowMs) {
    hits.set(key, { start: now, count: 1 });
    return next();
  }
  if (current.count >= 10) {
    res.setHeader('Retry-After', String(Math.ceil((windowMs - (now - current.start)) / 1000)));
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }
  current.count += 1;
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY) }));
app.use(express.static(path.join(__dirname), { dotfiles: 'deny', index: 'index.html' }));

app.post('/api/chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI is not configured yet. Add OPENAI_API_KEY in the hosting environment.' });
    }
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    if (message.length > 8000) return res.status(413).json({ error: 'Message is too long. Please keep it under 8,000 characters.' });
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-16) : [];
    const input = [...history, { role: 'user', content: message }]
      .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let upstream;
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          instructions: 'You are AgentAI, a practical personal assistant. Be concise and clear. Help draft, plan, compare information supplied by the user, and organize tasks. Never claim to have booked, purchased, sent, submitted, or changed anything unless a connected tool actually did it. Ask for confirmation before consequential actions. Protect private data and warn users not to share passwords or one-time codes.',
          input,
          max_output_tokens: 700
        })
      });
    } finally {
      clearTimeout(timeout);
    }
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 429 ? upstream.status : 502;
      const msg = upstream.status === 401 ? 'AI API key was rejected. Check the server secret.'
        : upstream.status === 429 ? 'AI API quota or rate limit reached. Check your API billing and limits.'
        : (data?.error?.message || 'AI provider returned an error.');
      return res.status(status).json({ error: msg });
    }
    const reply = (data.output || []).flatMap(item => item.content || [])
      .filter(part => part.type === 'output_text').map(part => part.text).join('\n').trim();
    if (!reply) return res.status(502).json({ error: 'The AI returned an empty response. Try again.' });
    res.json({ reply });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'The AI took too long to respond. Please try again.' });
    console.error('AgentAI chat error:', err.message);
    res.status(500).json({ error: 'Server error. Check the server logs.' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`AgentAI running on port ${port}`));
