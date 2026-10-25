
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const PORT = Number(process.env.PORT || 3000);

const MODELS = [
  process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  'gemini-2.0-flash'
];

function indiaTime() {
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
    time: indiaTime()
  });
});

app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: 'index.html'
}));

app.post('/api/chat', async (req, res) => {
  try {
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
        role: ['assistant', 'model'].includes(item.role)
          ? 'model'
          : 'user',
        parts: [{ text: item.content.slice(0, 4000) }]
      }));

    contents.push({
      role: 'user',
      parts: [{
        text: `Current date and time in India: ${indiaTime()}\n\nUser question: ${message}`
      }]
    });

    const systemInstruction = `
You are AgentAI, a smart general-purpose AI assistant.

Your job:
- Answer the user's actual question directly.
- Never replace a real answer with "Hello, how can I help you?"
- Understand Hindi, English and Hinglish.
- Help with education, coding, mathematics, science, writing,
  general knowledge, planning and everyday questions.
- Explain difficult topics step by step when helpful.
- Use the supplied India date and time for questions about today,
  tomorrow, the weekday and current time.
- Use Google Search when enabled and current or changing information
  needs verification.
- Never claim to have searched the web unless the search tool was used.
- Never invent facts, sources or completed actions.
- If uncertain, explain the uncertainty honestly.
- Be clear, useful, respectful and concise.
`;

    let lastError = 'AI is temporarily unavailable. Try again.';

    for (const model of [...new Set(MODELS)]) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              contents,
              tools: [{ google_search: {} }],
              generationConfig: {
                maxOutputTokens: 1200,
                temperature: 0.7
              }
            }),
            signal: AbortSignal.timeout(30000)
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          lastError = data.error?.message ||
            `Gemini API returned ${response.status}`;

          console.error(`${model}:`, lastError);

          // A bad key or permission issue will not be fixed by
          // trying another model.
          if ([401, 403].includes(response.status)) {
            return res.status(502).json({
              error: 'Gemini API key or permission problem. Check Render.'
            });
          }

          continue;
        }

        const candidate = data.candidates?.[0];

        const reply = (candidate?.content?.parts || [])
          .map(part => part.text || '')
          .filter(Boolean)
          .join('\n')
          .trim();

        if (!reply) {
          lastError = 'The AI returned no text.';
          continue;
        }

        const sources = [];

        for (const part of candidate.content.parts || []) {
          for (const meta of part.metadata || []) {
            if (meta.url) {
              sources.push({
                title: meta.title || meta.url,
                url: meta.url
              });
            }
          }
        }

        // Google Search grounding metadata can contain web sources.
        for (const chunk of
          candidate.groundingMetadata?.groundingChunks || []) {
          const web = chunk.web;

          if (web?.uri) {
            sources.push({
              title: web.title || web.uri,
              url: web.uri
            });
          }
        }

        const uniqueSources = [
          ...new Map(sources.map(s => [s.url, s])).values()
        ];

        return res.json({
          reply,
          sources: uniqueSources
        });

      } catch (error) {
        lastError = error.message || 'Connection error';
        console.error(`${model}:`, lastError);
      }
    }

    return res.status(503).json({
      error: 'AI could not answer right now. Check Render logs and API quota.'
    });

  } catch (error) {
    console.error('AgentAI error:', error);

    return res.status(500).json({
      error: 'Server error. Check Render logs.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`AgentAI running on port ${PORT}`);
});
