
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
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
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (message.length > 8000) {
      return res.status(413).json({ error: 'Message is too long.' });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-16)
      : [];

    const contents = [...history, { role: 'user', content: message }]
      .filter(m =>
        m &&
        ['user', 'assistant'].includes(m.role) &&
        typeof m.content === 'string'
      )
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content.slice(0, 8000) }]
      }));

    const models = [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite'
    ];

    let lastError = 'AI is temporarily busy. Please try again.';
    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'x-goog-api-key': apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{
                  text: 'You are AgentAI, a practical personal assistant. Give concise, clear answers. Never claim to have performed actions unless you actually did.'
                }]
              },
              contents,
              generationConfig: { maxOutputTokens: 700 }
            }),
            signal: AbortSignal.timeout(15000)
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          lastError = data.error?.message || `Model ${model} failed`;
          console.error(`Gemini ${model} error:`, lastError);

          if ([400, 401, 403].includes(response.status)) {
            return res.status(502).json({ error: lastError });
          }
          continue;
        }

        const reply = (data.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || '')
          .join('\n')
          .trim();

        if (reply) return res.json({ reply });
        lastError = 'Gemini returned an empty response.';
      } catch (err) {
        lastError = err.message || 'Connection error';
        console.error(`Gemini ${model} error:`, lastError);
      }
    }

    return res.status(503).json({
      error: 'All AI models are busy or unavailable. Please try again shortly.'
    });
  } catch (err) {
    console.error('AgentAI error:', err.message);
    return res.status(500).json({ error: 'Server error. Check Render logs.' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`AgentAI running on port ${port}`));
