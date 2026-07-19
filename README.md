# Tic Tac Toe — hidden API key + online multiplayer + voice chat

This version has three ways to play:
- **Human vs Human** (same device)
- **Human vs AI** — moves come from OpenRouter, via a backend proxy that
  keeps your API key private (see below)
- **Online Multiplayer** — two people on different devices, connected
  through this same server, with optional voice chat

## Run it locally

```bash
cd ttt-proxy
npm install
cp .env.example .env
```

Open `.env` and fill in your real key:

```
OPENROUTER_API_KEY=sk-or-v1-your-real-key-here
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free
```

Then:

```bash
npm start
```

Open **http://localhost:3000** — that's the game, served by this same
server. To test online multiplayer, open the same URL in a second
browser tab/window/device.

## How online multiplayer works

- One player taps **Create Room** and gets a 4-character code
- The other player taps **Join Room** and enters that code
- Moves are relayed live through this server via Socket.IO — nobody
  needs to expose their own device to the internet, only the server
  needs to be reachable
- Room state lives only in server memory — closing the server or both
  players leaving clears it (there's no database, so this is fine for
  casual games but rooms won't survive a server restart)

## How the microphone (voice chat) works

Once both players are in a match, a 🎤 button appears in the game
screen. Tapping it asks for microphone permission, then sets up a
direct peer-to-peer audio connection (WebRTC) between the two
players — this server only relays the initial connection handshake
(signaling); the actual voice audio flows directly between the two
browsers, not through the server. Tap 🎤 again to mute/disconnect.

Notes:
- Browsers require HTTPS (or `localhost`) for microphone access, so
  voice chat won't work if you deploy this over plain HTTP.
- WebRTC uses a public STUN server (Google's) to help the two browsers
  find each other; no audio data passes through it.

## Deploy it so others can play

You need somewhere that can run a small Node.js server with WebSocket
support (this is not a static site, so GitHub Pages / plain file
hosting won't work). Good free-tier options:

- **Render** (render.com) — "New Web Service", connect your repo,
  build command `npm install`, start command `npm start`
- **Railway** (railway.app) — similar one-click deploy from a repo
- **Fly.io** also works well for this

On whichever platform you pick, set `OPENROUTER_API_KEY` and
`OPENROUTER_MODEL` as **environment variables in that platform's
dashboard** — never commit `.env` to git or paste your key into any
file you share. `.gitignore` already excludes `.env` for you. Also
make sure the platform gives you an HTTPS URL (most free tiers do
by default) so the microphone feature works.

## Why the key is server-side

A static HTML file has no private storage — anything in the file's
code is visible to anyone who opens dev tools or views source. This
proxy server is what actually solves that: the key sits only in an
environment variable on your server, and the browser only ever talks
to your server, never to OpenRouter directly.

## Files

- `server.js` — Express + Socket.IO server: OpenRouter proxy, room
  management, and WebRTC signaling relay
- `public/index.html` — the game (frontend)
- `.env.example` — template for your environment variables (copy to `.env`)
- `package.json` — dependencies

