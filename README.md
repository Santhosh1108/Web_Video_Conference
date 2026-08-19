# MeetFlow

Peer-to-peer video meetings in one browser tab — no accounts, no third-party
video SDK, no per-minute billing. Camera/mic media streams **directly between
participants over WebRTC**; a small Express + Socket.IO server only handles
the initial handshake (who's in the room, and relaying the SDP offer/answer
and ICE candidates needed to establish that direct connection).

> This started as a video-calling demo built on the Agora SDK. It's since
> been rebuilt on native `RTCPeerConnection` — no external video vendor, no
> API key, nothing to sign up for.

## Features

- **Peer-to-peer video/audio** via native WebRTC (mesh topology — good for
  small rooms; see [Limitations](#limitations) for the scaling story).
- **Pre-join camera preview** — see and hear yourself, pick your camera/mic,
  before anyone else can.
- **Live speaking indicator** — not a guess: each participant's tile ring
  lights up based on real-time RMS volume from their actual mic track
  (Web Audio `AnalyserNode`), with a short hold time so it doesn't flicker.
- **Device switching mid-call** — swap camera or microphone without
  rejoining; the new track is hot-swapped into every peer connection.
- **Screen sharing** — swap your camera track for a screen-share track,
  auto-reverts if you stop sharing from the browser's own UI.
- **In-call chat** with unread badges, plus a live participant roster.
- **Emoji reactions** that float up over the sender's video tile.
- **Keyboard shortcuts** — `M` mute, `V` camera, `S` share screen, `F`
  fullscreen the focused tile, `R` open reactions, `Esc` closes panels.
- **Shareable invite links** with one-click copy, and a standalone
  camera/mic test page with live resolution/FPS/mic-level stats.
- Fully responsive, from a 4-up desktop grid down to a single-column phone
  layout with slide-in panels.

## Architecture

```
┌──────────┐        WebRTC media (P2P)        ┌──────────┐
│ Browser A│ ◄────────────────────────────────►│ Browser B│
└────┬─────┘                                    └─────┬────┘
     │        Socket.IO (join / offer / answer /       │
     │        ICE candidates / chat / reactions)        │
     └───────────────────► server.js ◄───────────────────┘
                     (Express + socket.io, stateless
                      beyond in-memory room membership)
```

- `server.js` — Express static server + Socket.IO signaling. Never touches
  audio/video; only relays small JSON messages.
- `public/js/room_rtc.js` — all `RTCPeerConnection` / `getUserMedia` /
  `getDisplayMedia` logic: creating peers, exchanging SDP, ICE, device
  switching, the speaking-detection analyser, reactions, and controls.
- `public/js/room_rtm.js` — chat and the participant list, over the same
  socket.
- `public/js/room.js` — pure UI: toasts, drawers, popovers, keyboard
  shortcuts, fullscreen/focus mode. No networking.
- `public/check/` — standalone device-test page, independent of the room
  code so it works even if you never join a call.
- `test/signaling.test.js` — spins up the real server and drives it with two
  genuine `socket.io-client` connections to verify the whole signaling
  contract (join, offer/answer/ICE relay, media-state, chat, the reaction
  allow-list, and leave/roster updates).

## Getting started

```bash
git clone https://github.com/Santhosh1108/Web_Video_Conference.git
cd Web_Video_Conference
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs (or two devices on the same
network) to test a call with yourself.

### Scripts

| Command         | What it does                                            |
| --------------- | -------------------------------------------------------- |
| `npm start`     | Run the server (`http://localhost:3000`)                |
| `npm run check` | `node --check` every server/client script                |
| `npm run lint`  | ESLint over the whole project                             |
| `npm test`      | Integration test against the real signaling server        |

CI (`.github/workflows/ci.yml`) runs all three, plus a smoke test that boots
the server and hits `/healthz`, on every push/PR against Node 18 and 20.

## Limitations

Being upfront about the trade-offs, since they're the interesting part:

- **Mesh topology.** Every participant connects to every other participant
  directly, so bandwidth/CPU cost grows roughly with *n²*. This is fine for
  small meetings (a handful of people); a production-scale version would
  route media through an SFU (e.g. mediasoup, LiveKit, Janus) instead.
- **STUN only, no TURN.** Peers behind strict NATs/firewalls (common on
  corporate networks) may fail to connect directly. Adding a TURN server
  (e.g. coturn) to `RTC_CONFIG` in `room_rtc.js` fixes this.
- **In-memory room state.** Room membership lives in the Socket.IO adapter's
  memory — restarting the server drops active rooms. A Redis adapter would
  fix this for a multi-instance deployment.
- **No recording/persistence.** Nothing about a call is stored anywhere.

## Tech stack

Node.js, Express, Socket.IO, and the browser's native WebRTC + Web Audio
APIs — no video-calling SDK or vendor dependency.
