# AgentAI — Real AI connected prototype

This version connects the chat interface to the OpenAI Responses API through a small Node.js backend. The API key stays on the server and is not included in browser code.

## Run locally
1. Install Node.js 18 or newer.
2. Open this project folder in a terminal.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Put your own OpenAI API key in `.env` as `OPENAI_API_KEY=...`. Do not send your key in chat or commit the `.env` file.
6. Run `npm start`.
7. Open `http://localhost:3000` in your browser.

An OpenAI API account with API billing/credits is required; a ChatGPT subscription does not automatically include API usage. API usage may incur charges.

## Current scope
- Real AI chat with short conversation history.
- Existing task list, booking request drafts, price comparisons, and writing form are local prototype features.
- Booking, sending messages, live price lookups, reminders/notifications, sign-in, and persistent cloud storage are NOT connected yet.

Before public deployment, add authentication, rate limiting, abuse protection, a privacy notice, and secure hosting. Never expose the API key in frontend JavaScript.
