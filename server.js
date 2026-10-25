
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

const hits = new Map();

app.use('/api/', (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = hits.get(key);

  if (!current || now - current.start >= 60000) {
    hits.set(key, { start: now, count: 1 });
    return next();
  }

  if (current.count >= 10) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      error: 'Too many requests. Please wait a minute.'
    });
  }

  current.count++;
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

app.use(express.static(path.join(__dirname), {
  dotfiles: 'deny',
  index: 'index.html'
}));

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: 'Add GEMINI_API_KEY in Render Environment.'
      });
    }

    const message = String(req.body?.message || '').trim();

    if (!message) {
      return res.status(400).json({
        error: 'Message is required.'
      });
    }

    if (message.length > 8000) {
      return res.status(413).json({
        error: 'Message is too long.'
      });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-16)
      : [];

    const contents = [...history, {
      role: 'user',
      content: message
    }]
      .filter(m =>
        m &&
        ['user', 'assistant'].includes(m.role) &&
        typeof m.content === 'string'
      )
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content.slice(0, 8000) }]
      }));

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'You are AgentAI, a practical personal assistant. Give concise, clear answers. Help users draft, plan and organize tasks. Never claim to have performed actions unless you actually did.'
            }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: 700
          }
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Gemini API error:', data.error?.message);

      return res.status(502).json({
        error: data.error?.message ||
          'Gemini API error. Check the Render logs.'
      });
    }

    const reply = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || '')
      .join('\n')
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: 'Gemini returned an empty response.'
      });
    }

    res.json({ reply });
  } catch (err) {
    console.error('AgentAI error:', err.message);

    res.status(err.name === 'TimeoutError' ||
      err.name === 'AbortError' ? 504 : 500).json({
      error: 'Server error. Check the Render logs.'
    });
  }
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`AgentAI running on port ${port}`);
});
