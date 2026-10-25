
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function getIndiaDate() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  );
}

function getIndiaInfo() {
  const now = new Date();

  return {
    day: new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      timeZone: 'Asia/Kolkata'
    }).format(now),

    date: new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    }).format(now),

    time: new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    }).format(now)
  };
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    time: getIndiaInfo()
  });
});

// Serve the website
app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: 'index.html'
}));

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();

    if (!message) {
      return res.status(400).json({
        reply: 'Please type your question.',
        error: 'Message is required.'
      });
    }

    if (message.length > 8000) {
      return res.status(413).json({
        reply: 'Your message is too long.',
        error: 'Message is too long.'
      });
    }

    const q = message.toLowerCase().replace(/[?!.,]/g, ' ');
    const info = getIndiaInfo();

    // Answer date, weekday and time without using the AI API.
    const asksDay =
      /\btoday day\b/.test(q) ||
      /\bday name\b/.test(q) ||
      /\bwhat day is it\b/.test(q) ||
      /\bwhich day is it\b/.test(q) ||
      /\bwhat day is today\b/.test(q) ||
      /\bday today\b/.test(q) ||
      /aaj kaun sa din/.test(q) ||
      /aaj konsa din/.test(q) ||
      /aaj kya din/.test(q);

    const asksDate =
      /\btoday'?s date\b/.test(q) ||
      /\bwhat is the date\b/.test(q) ||
      /\bcurrent date\b/.test(q) ||
      /aaj ki date/.test(q) ||
      /aaj ki tarikh/.test(q);

    const asksTime =
      /\bcurrent time\b/.test(q) ||
      /\bwhat time is it\b/.test(q) ||
      /\btime right now\b/.test(q) ||
      /abhi kitne baje/.test(q) ||
      /abhi ka time/.test(q);

    if (asksDay || asksDate || asksTime) {
      let reply;

      if (asksDay) {
        reply = `Today is ${info.day}.`;
      } else if (asksDate) {
        reply = `Today's date is ${info.date}.`;
      } else {
        reply = `The current time in India is ${info.time}.`;
      }

      return res.json({
        reply,
        response: reply,
        sources: []
      });
    }

    // Gemini is needed for other questions.
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        reply: 'GEMINI_API_KEY is missing in Render Environment.',
        error: 'GEMINI_API_KEY is missing.'
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
        parts: [{
          text: item.content.slice(0, 4000)
        }]
      }));

    contents.push({
      role: 'user',
      parts: [{
        text: `Current date in India: ${info.date}
Current weekday in India: ${info.day}
Current time in India: ${info.time}

User question: ${message}`
      }]
    });

    const instructions = `
You are AgentAI, a helpful general-purpose personal AI assistant.

Answer the user's actual question directly.
Never respond to a real question with only a generic greeting.
Understand Hindi, English and Hinglish.
Help with coding, maths, science, studies, writing,
general knowledge and everyday problem-solving.
Explain step by step when useful.
Use the supplied India date, weekday and time for date questions.
Use Google Search for current information when the search tool works.
Never pretend to have searched the web if you have not.
Never claim to have performed an action you did not perform.
Be honest if you do not know something.
`;

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

      const reply = response.status === 429
        ? 'Gemini API quota or request limit reached. Date and time questions still work. Try other AI questions after the quota resets.'
        : 'Gemini API error. Check the latest Render Logs.';

      return res.status(502).json({
        reply,
        response: reply,
        error: reply
      });
    }

    const candidate = data.candidates?.[0];

    const reply = (candidate?.content?.parts || [])
      .map(part => part.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!reply) {
      return res.status(502).json({
        reply: 'The AI returned an empty answer. Please try again.',
        error: 'Empty AI response.'
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
      response: reply,
      sources: [...new Map(
        sources.map(source => [source.url, source])
      ).values()]
    });

  } catch (error) {
    console.error('AgentAI error:', error);

    return res.status(503).json({
      reply: 'AI connection failed. Please try again.',
      error: 'AI connection failed.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`AgentAI running on port ${PORT}`);
});
