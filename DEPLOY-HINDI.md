# AgentAI ko live karne ke liye seedhe steps

Code aur Render deployment configuration taiyaar hai. Public URL banane ke liye hosting account aur secret API key ka authorization zaroori hai; main aapke personal accounts create/login ya billing approve nahi kar sakta.

## 1) OpenAI API key
- OpenAI API platform par API key banayein aur billing/usage limit set karein.
- API key ko chat mein mat bhejein, HTML mein mat daalein, aur public GitHub repo mein kabhi commit na karein.

## 2) GitHub par project
- ZIP extract karein.
- Files ko apni **private** GitHub repository mein upload karein.

## 3) Render par deploy
- Render dashboard → New → Blueprint.
- GitHub repository connect karein; `render.yaml` service configure karega.
- `OPENAI_API_KEY` secret field mein apni key paste karein.
- Deploy complete hone par Render ka public URL open karein.

## 4) Check
- Public URL open karke chat test karein.
- `/api/health` kholkar `aiConfigured: true` confirm karein.

## Current limitations
- Real AI chat OpenAI API key ke baad kaam karega; API billing ChatGPT subscription se alag ho sakti hai.
- Tasks browser session mein local hain; cloud sync/login nahi hai.
- Booking, payments, email sending, form submission aur live deal lookup abhi real external services se connected nahi hain. App inke drafts/organization mein help karta hai.
- Prototype par basic request limiting hai; public production release se pehle authentication, persistent rate limiting, privacy policy, monitoring, and further security review add karein.
