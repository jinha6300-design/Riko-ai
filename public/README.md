# RIKO AI

Hindi/English voice assistant (Gemini) for Android Chrome. Key stays on the server.

## Deploy (Render, free, ~5 min)
1. Create a free Gemini key at https://aistudio.google.com/apikey
2. Push this folder to a new GitHub repo.
3. render.com -> New -> Blueprint -> pick the repo (reads render.yaml).
4. When asked, paste GEMINI_API_KEY and choose APP_PASSCODE.
5. Open the https://riko-ai.onrender.com URL on your phone -> Chrome menu -> Add to Home screen.

## Local
GEMINI_API_KEY=xxx APP_PASSCODE=1234 npm start

## Limits on Android browsers
- Full-screen sharing (getDisplayMedia) is not supported in Android Chrome. Use photo/screenshot attach.
- A web page cannot click or type in other apps or other sites. Riko opens links and prepares call/WhatsApp/maps; you tap once.
- Mic works only on HTTPS and while the tab is open and screen on.
- Deeper control needs a native Android app (AccessibilityService, MediaProjection, foreground service).
