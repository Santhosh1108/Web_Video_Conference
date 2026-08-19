# Web Video Conference

A real-time, browser-based video conferencing app built with the **Agora RTC + RTM SDKs** — multi-user video rooms, live chat, mic/camera toggling, and screen sharing, with no backend required.

## Features

- Create or join a room by name (shareable link via `?room=<id>`)
- Multi-party video/audio via Agora RTC (WebRTC under the hood)
- Live text chat + real-time participant list via Agora RTM
- Mic / camera mute toggle, screen sharing, click-to-expand video tiles
- Camera/mic pre-flight check page before joining a room
- Graceful handling of denied camera/mic permissions and dropped connections

## Tech Stack

- Vanilla HTML/CSS/JS (no framework, no build step)
- [Agora RTC SDK](https://www.agora.io/) for media streaming
- [Agora RTM SDK](https://www.agora.io/) for signaling and chat

## Architecture

```
Browser A ──┐                                   ┌── Browser B
            ├── Agora RTC (media: audio/video) ──┤
            ├── Agora RTM (signaling: chat,     ──┤
            │   presence, join/leave events)     │
            └── sessionStorage (display name, uid)┘
```

There's no application server — Agora's SDKs handle media routing and
signaling directly between clients. `lobby.js` collects a display name and
room ID and redirects into `room.html?room=<id>&name=<name>`. `room_rtc.js`
owns the media session (join/publish/subscribe, mute, screen share);
`room_rtm.js` owns presence and chat (member list, join/leave events,
message broadcast). `room.js` handles pure UI behavior (chat panel
toggle, video tile expand/shrink).

## Known Limitations / Roadmap

- **No backend / token server** — the Agora App ID is embedded client-side
  since there's no server to mint short-lived RTC/RTM tokens. Fine for a
  demo; a production version would add a small token-issuing server so
  the App ID + certificate never ship to the client.
- **No authentication** — anyone with the room link can join. Would add
  room passwords or auth-gated invites next.
- **No automated tests** — no unit/integration test suite yet.
- **No persistence** — chat history and room state are lost on refresh;
  nothing is stored server-side.
- **Client-only input sanitization** — display names/messages are HTML-escaped
  before rendering (fixes a stored-XSS issue that existed in the original
  chat implementation), but there's still no server-side validation since
  there's no server.

## Recent Fixes

- Fixed a stored-XSS vulnerability: chat messages and display names were
  inserted into the DOM unescaped, letting any participant inject
  arbitrary HTML/JS that would execute in every other participant's
  browser. All user-controlled strings are now escaped before rendering.
- Added error handling around camera/mic permission requests — denied or
  missing devices now show a clear message instead of silently failing.
- Added connection-state feedback so a dropped network connection is
  surfaced to the user instead of failing silently.
- Fixed the camera-check page, which called `$(...)` (jQuery) without ever
  loading jQuery — it now runs on plain JS and shows clear success/error
  status.
- Fixed a duplicate `id="nav__links"` in the lobby page (invalid HTML).

## Running Locally

Because this is a static site, serve it with any static file server (opening
`index.html` directly via `file://` will break camera permissions in most
browsers):

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
