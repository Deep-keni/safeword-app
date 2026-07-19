# SafeWord — Silent Emergency Signal

A covert personal safety web app disguised as a voice journal. Detects a user's 
pre-set secret code phrase (even when paraphrased) via AI semantic matching, and 
silently alerts a trusted contact with live location — no visible button, no 
obvious trigger.

## Problem
Victims of harassment, stalking, or assault often cannot safely use a visible 
panic button or say an obvious distress word. SafeWord lets them trigger help 
just by speaking naturally.

## How it works
1. User sets a secret code phrase, emergency category, and trusted contact email.
2. App continuously transcribes speech via the Web Speech API.
3. Each transcript segment is compared to the code phrase using Gemini text 
   embeddings + cosine similarity (threshold: 0.72).
4. On a semantic match, the app silently captures GPS location and sends an 
   automated email alert via EmailJS — no visible UI change.

## Tech Stack
- Next.js (React) frontend
- Web Speech API for continuous voice transcription
- Google Gemini embedding API for semantic similarity matching
- Browser Geolocation API
- EmailJS for serverless email alerts
- Deployed on Vercel

## Setup
1. Clone the repo, run `npm install`
2. Create `.env.local` with:
   GEMINI_API_KEY=your_key
   NEXT_PUBLIC_EMAILJS_SERVICE_ID=your_id
   NEXT_PUBLIC_EMAILJS_TEMPLATE_ID=your_id
   NEXT_PUBLIC_EMAILJS_PUBLIC_KEY=your_key
3.3. `npm run dev`

## Live Demo
https://safeword-app.vercel.app/

## Known Limitations
- Requires browser tab active + mic permission for continuous listening
- Best tested on Chrome desktop (Web Speech API support varies by browser)
- Future version: native app with background listening service

## Built for
Idea2Impact 2026 Online Hackathon (NxtWave Academy)



