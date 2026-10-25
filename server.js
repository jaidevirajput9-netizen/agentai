
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const PORT = Number(process.env.PORT || 3000);
const MODEL = 'gemini-3.8-flash';

function getIndiaTime() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(new Date());
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    time: getIndiaTime()
  });
});

app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: 'index.html'
}));

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY missing in Render Environment.'
    });
  }

  const message = String(req.body?.message || '').trim();

  if (!message) {
    return res.status(400).json({
      error: 'Please enter a message.'
    });
  }

  if (message.length > 8000) {
    return res.status(413).json({
      error: 'Message is too long.'
    });
  }

  const history = Array.isArray(req.body?.history)
    ? req.body.history.slice(-12)
    : [];

  const contents = history
    .filter(item =>
      item &&
      ['user', 'assistant', 'model'].includes(item.role) &&
      typeof item.content === 'string' &&
      item.content.trim()
    )
    .map(item => ({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: item.content.slice(0, 4000) }]
    }));

  contents.push({
    role: 'user',
    parts: [{
      text: `Current India date and time: ${getIndiaTime()}\n\nUser's question: ${message}`
    }]
  });

  const instructions = `
You are AgentAI, a helpful general-purpose personal AI assistant.

Answer the actual question directly. Never respond to a real question
with only a generic greeting.

You can help with general knowledge, study, coding, maths, science,
writing, planning and everyday problem-solving.

Understand Hindi, English and Hinglish. Reply in the user's language.
Explain step by step when useful.
Use the supplied India date and time for today's date, weekday and time.
Use Google Search to verify current information when needed.
Never claim you searched the web if you did not.
Never claim to perform an action you did not actually perform.
If unsure, say so honestly.
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: instructions }]
          },
          contents,
          tools: [{ google_search: {} }],
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.7
          }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Gemini API error:', response.status, data);

      const status = response.status === 429 ? 429 : 502;

      return res.status(status).json({
        error: response.status === 429
          ? 'Gemini request limit reached. Try again later.'
          : 'Gemini API error. Check Render Logs for details.'
      });
    }

    const candidate = data.candidates?.[0];

    const reply = (candidate?.content?.parts || [])
      .map(part => part.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!reply) {
      console.error('Empty Gemini response:', data);

      return res.status(502).json({
        error: 'AI returned an empty answer. Please try again.'
      });
    }

    const sources = (
      candidate?.groundingMetadata?.groundingChunks || []
    )
      .filter(chunk => chunk.web?.uri)
      .map(chunk => ({
        title: chunk.web.title || chunk.web.uri,
        url: chunk.web.uri
      }));

    return res.json({
      reply,
      sources: [...new Map(
        sources.map(source => [source.url, source])
      ).values()]
    });

  } catch (error) {
    console.error('AgentAI request error:', error);

    return res.status(503).json({
      error: 'AI request timed out or connection failed. Please try again.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`AgentAI running on port ${PORT}`);
});
