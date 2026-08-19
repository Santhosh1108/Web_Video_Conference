// Native WebRTC media/signaling layer. No third-party SDK — just
// getUserMedia, RTCPeerConnection and Socket.IO for handshaking.

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const REACTION_EMOJI = new Set(["👍", "🎉", "❤️", "😂", "👏", "✋"]);

let localStream = null;
let localScreenStream = null;
let sharingScreen = false;
let hasJoined = false;
let mirrored = true;

const peerConnections = new Map();
const remoteUsers = new Map();
const pendingCandidates = new Map();
const speakingMeters = new Map(); // uid -> cleanup fn

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/* ------------------------------------------------------------ Utilities */
function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?";
}

/* --------------------------------------------------- Video tile helpers */
function ensureVideoElement(participantUid, name = "Participant") {
  const existing = document.getElementById(`user-container-${participantUid}`);
  if (existing) return existing;

  const wrapper = document.createElement("div");
  wrapper.className = "video__container";
  wrapper.id = `user-container-${participantUid}`;
  wrapper.dataset.uid = participantUid;

  const video = document.createElement("video");
  video.className = "video-player";
  video.id = `user-${participantUid}`;
  video.autoplay = true;
  video.playsInline = true;

  const avatar = document.createElement("div");
  avatar.className = "video__avatar";
  avatar.hidden = true;
  avatar.textContent = initials(name);

  const label = document.createElement("div");
  label.className = "video__name";
  label.innerHTML = `<span class="label-text"></span>`;
  label.querySelector(".label-text").textContent = name;

  wrapper.append(video, avatar, label);
  document.getElementById("streams__container").appendChild(wrapper);
  return wrapper;
}

function setTileVideoState(participantUid, videoEnabled) {
  const wrapper = document.getElementById(`user-container-${participantUid}`);
  if (!wrapper) return;
  wrapper.querySelector(".video__avatar").hidden = videoEnabled;
  wrapper.querySelector(".video-player").style.visibility = videoEnabled ? "visible" : "hidden";
}

function setTileMicState(participantUid, micEnabled) {
  const wrapper = document.getElementById(`user-container-${participantUid}`);
  if (!wrapper) return;
  const label = wrapper.querySelector(".video__name");
  let flag = label.querySelector(".mic-off-flag");
  if (micEnabled) {
    flag?.remove();
  } else if (!flag) {
    flag = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    flag.setAttribute("class", "mic-off-flag");
    flag.setAttribute("viewBox", "0 0 24 24");
    flag.setAttribute("fill", "currentColor");
    flag.innerHTML = '<path d="M19 11h-1.7a5.3 5.3 0 0 1-.14 1.2l1.27 1.27A7.2 7.2 0 0 0 19 11zM4.27 3L3 4.27 8 9.27V11a4 4 0 0 0 5.87 3.54l1.2 1.2A5.94 5.94 0 0 1 6 11H4.3a7.2 7.2 0 0 0 6.7 7.17V21h2v-2.83a7.1 7.1 0 0 0 2.13-.6L19.73 22 21 20.73 4.27 3zM12 15a3 3 0 0 0 3-3v-.18l-3-3V12a1 1 0 0 1-2 0V8.82L8.1 6.9C8.03 7.25 8 7.62 8 8v4a4 4 0 0 0 4 4z"/>';
    label.prepend(flag);
  }
}

function removeVideo(participantUid) {
  document.getElementById(`user-container-${participantUid}`)?.remove();
  stopSpeakingMeter(participantUid);
}

/* -------------------------------------------------------- Toast wiring */
const say = (msg, kind) => window.toast?.(msg, kind);

/* ------------------------------------------------------ Device pickers */
const cameraSelects = ["camera-select", "camera-select-live"].map((id) => document.getElementById(id));
const micSelects = ["mic-select", "mic-select-live"].map((id) => document.getElementById(id));

async function populateDeviceLists() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");

  const fill = (selects, list, kind) => {
    selects.forEach((select) => {
      if (!select) return;
      const current = select.value;
      select.innerHTML = "";
      if (list.length === 0) {
        const opt = document.createElement("option");
        opt.textContent = `No ${kind} found`;
        select.appendChild(opt);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      list.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `${kind} ${i + 1}`;
        select.appendChild(opt);
      });
      if (list.some((d) => d.deviceId === current)) select.value = current;
    });
  };

  fill(cameraSelects, cams, "camera");
  fill(micSelects, mics, "microphone");
}

function syncDeviceSelectPairs() {
  const syncPair = (a, b) => {
    if (!a || !b) return;
    a.addEventListener("change", () => { b.value = a.value; });
    b.addEventListener("change", () => { a.value = b.value; });
  };
  syncPair(cameraSelects[0], cameraSelects[1]);
  syncPair(micSelects[0], micSelects[1]);
}
syncDeviceSelectPairs();

/* -------------------------------------------------------- Mirror toggle */
function applyMirror() {
  document.getElementById("preview-video")?.classList.toggle("mirrored", mirrored);
  document.querySelector(`#user-container-${uid} .video-player`)?.classList.toggle("mirrored", mirrored && !sharingScreen);
}
["mirror-toggle", "mirror-toggle-live"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", (e) => {
    mirrored = e.target.checked;
    document.querySelectorAll(".mirror-toggle input").forEach((el) => { el.checked = mirrored; });
    applyMirror();
  });
});

/* ------------------------------------------------------- Speaking meter */
function attachSpeakingMeter(participantUid, stream, { onLevel } = {}) {
  stopSpeakingMeter(participantUid);
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return;

  try {
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = null;
    let lastAbove = 0;
    const THRESHOLD = 0.06;
    const HOLD_MS = 380;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      onLevel?.(rms);

      const wrapper = document.getElementById(`user-container-${participantUid}`);
      if (wrapper) {
        const now = performance.now();
        if (rms > THRESHOLD) lastAbove = now;
        wrapper.classList.toggle("speaking", now - lastAbove < HOLD_MS);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    speakingMeters.set(participantUid, () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
    });
  } catch (err) {
    console.warn("Speaking meter unavailable:", err);
  }
}

function stopSpeakingMeter(participantUid) {
  speakingMeters.get(participantUid)?.();
  speakingMeters.delete(participantUid);
}

/* --------------------------------------------------------- Local media */
async function startLocalMedia({ videoDeviceId, audioDeviceId } = {}) {
  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {})
    },
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
      ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {})
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = stream;
  await populateDeviceLists();
  return stream;
}

async function initPrejoinPreview() {
  const previewVideo = document.getElementById("preview-video");
  const noCam = document.getElementById("prejoin__no-cam");
  const noCamText = document.getElementById("prejoin__no-cam-text");

  document.getElementById("prejoin__room-name").textContent = roomId;

  try {
    await startLocalMedia();
    previewVideo.srcObject = localStream;
    previewVideo.classList.toggle("mirrored", mirrored);
    noCam.style.display = "none";

    attachSpeakingMeter(`${uid}-preview`, localStream, {
      onLevel: (rms) => {
        const meter = document.querySelector("#preview-meter span");
        if (meter) meter.style.width = `${Math.min(100, Math.round(rms * 340))}%`;
      }
    });
  } catch (err) {
    console.error(err);
    noCam.style.display = "flex";
    previewVideo.style.display = "none";
    document.getElementById("join-btn").disabled = false;

    if (err.name === "NotAllowedError") {
      noCamText.textContent = "Camera/microphone permission denied. You can still join with them off, or allow access and reload.";
    } else if (err.name === "NotFoundError") {
      noCamText.textContent = "No camera or microphone found. You can still join audio/video-off.";
    } else {
      noCamText.textContent = "Couldn't access your camera/mic. You can still join.";
    }
    say("Couldn't access camera/mic — you can still join.", "error");
  }
}

function setLocalVideoTile() {
  const wrapper = ensureVideoElement(uid, `${displayName} (You)`);
  const video = wrapper.querySelector("video");
  video.muted = true;
  video.srcObject = sharingScreen ? localScreenStream : localStream;
  video.classList.toggle("mirrored", mirrored && !sharingScreen);
  video.play().catch(() => {});
  setTileVideoState(uid, sharingScreen || (localStream?.getVideoTracks()[0]?.enabled ?? false));
  setTileMicState(uid, localStream?.getAudioTracks()[0]?.enabled ?? false);
}

/* -------------------------------------------------------------- Peers */
async function createPeer(user, initiator) {
  if (peerConnections.has(user.socketId)) return peerConnections.get(user.socketId);

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections.set(user.socketId, pc);
  remoteUsers.set(user.socketId, user);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    const wrapper = ensureVideoElement(user.uid, user.displayName);
    const video = wrapper.querySelector("video");
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
    setTileVideoState(user.uid, stream.getVideoTracks().some((t) => t.enabled));
    setTileMicState(user.uid, stream.getAudioTracks().some((t) => t.enabled));
    attachSpeakingMeter(user.uid, stream);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { target: user.socketId, candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") pc.restartIce?.();
  };

  if (initiator) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socket.emit("offer", { target: user.socketId, offer: pc.localDescription });
  }

  return pc;
}

/* ------------------------------------------------------- Join / signal */
async function joinStreams() {
  const joinBtn = document.getElementById("join-btn");
  if (!joinBtn || hasJoined) return;

  joinBtn.disabled = true;
  joinBtn.textContent = "Joining…";

  try {
    if (!localStream) await startLocalMedia();
  } catch {
    // Proceed without media — audio/video-off join is still allowed.
  }

  hasJoined = true;
  document.getElementById("prejoin").style.display = "none";
  document.querySelector(".stream__actions").style.display = "flex";

  setLocalVideoTile();
  stopSpeakingMeter(`${uid}-preview`);
  if (localStream) attachSpeakingMeter(uid, localStream);

  socket.emit("join-room", { roomId, uid, displayName });
  say(`Joined room "${roomId}".`, "success");
}

socket.on("room-users", async (users) => {
  for (const user of users) await createPeer(user, true);
});

socket.on("user-joined", async (user) => {
  await createPeer(user, true);
  say(`${user.displayName} joined the room`, "info");
  window.addBotMessageToDom?.(`${user.displayName} joined the room`);
});

socket.on("offer", async ({ from, uid: remoteUid, displayName: remoteName, offer }) => {
  const user = { socketId: from, uid: remoteUid, displayName: remoteName };
  const pc = await createPeer(user, false);

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const queued = pendingCandidates.get(from) || [];
  for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
  pendingCandidates.delete(from);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { target: from, answer: pc.localDescription });
});

socket.on("answer", async ({ from, answer }) => {
  const pc = peerConnections.get(from);
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  const queued = pendingCandidates.get(from) || [];
  for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
  pendingCandidates.delete(from);
});

socket.on("ice-candidate", async ({ from, candidate }) => {
  const pc = peerConnections.get(from);
  if (!pc || !pc.remoteDescription) {
    const list = pendingCandidates.get(from) || [];
    list.push(candidate);
    pendingCandidates.set(from, list);
    return;
  }
  await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
});

socket.on("user-left", ({ socketId, uid: remoteUid, displayName: remoteName }) => {
  peerConnections.get(socketId)?.close();
  peerConnections.delete(socketId);
  remoteUsers.delete(socketId);
  pendingCandidates.delete(socketId);
  removeVideo(remoteUid);
  window.removeMemberFromDom?.(remoteUid);
  say(`${remoteName || "A participant"} left the room`, "info");
  window.addBotMessageToDom?.(`${remoteName || "A participant"} left the room`);
});

socket.on("media-state", ({ uid: remoteUid, type, enabled }) => {
  if (type === "video") setTileVideoState(remoteUid, enabled);
  if (type === "audio") setTileMicState(remoteUid, enabled);
});

/* -------------------------------------------------- Connection status */
const statusPill = document.getElementById("status-pill");
const statusLabel = document.getElementById("status-label");
function setStatus(state, label) {
  if (!statusPill) return;
  statusPill.dataset.state = state;
  statusLabel.textContent = label;
}
socket.on("connect", () => setStatus("live", "Live"));
socket.on("disconnect", () => setStatus("offline", "Disconnected"));
socket.io.on("reconnect_attempt", () => setStatus("connecting", "Reconnecting…"));
socket.io.on("reconnect", () => {
  setStatus("live", "Live");
  say("Reconnected.", "success");
  if (hasJoined) socket.emit("join-room", { roomId, uid, displayName });
});

/* ---------------------------------------------------------- Room code */
(() => {
  const roomCodeText = document.getElementById("room-code-text");
  if (roomCodeText) roomCodeText.textContent = roomId;

  document.getElementById("copy-link-btn")?.addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(link);
      say("Invite link copied to clipboard.", "success");
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  });
})();

/* ------------------------------------------------------------ Controls */
async function toggleMic(e) {
  if (!localStream) return say("No microphone available.", "error");
  const track = localStream.getAudioTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  e.currentTarget.classList.toggle("active", track.enabled);
  setTileMicState(uid, track.enabled);
  socket.emit("media-state", { type: "audio", enabled: track.enabled });
}

async function toggleCamera(e) {
  if (!localStream) return say("No camera available.", "error");
  const track = localStream.getVideoTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  e.currentTarget.classList.toggle("active", track.enabled);
  setTileVideoState(uid, track.enabled && !sharingScreen);
  socket.emit("media-state", { type: "video", enabled: track.enabled });
}

async function toggleScreen(e) {
  if (!hasJoined) return say("Join the meeting first.", "error");

  const screenButton = e.currentTarget;
  const cameraButton = document.getElementById("camera-btn");

  try {
    if (!sharingScreen) {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false
      });

      const screenTrack = localScreenStream.getVideoTracks()[0];
      sharingScreen = true;

      for (const pc of peerConnections.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(screenTrack);
      }

      const wrapper = ensureVideoElement(uid, `${displayName} (You)`);
      const video = wrapper.querySelector("video");
      video.srcObject = localScreenStream;
      video.classList.remove("mirrored");
      screenButton.classList.add("active");
      cameraButton?.classList.remove("active");
      setTileVideoState(uid, true);

      screenTrack.onended = () => stopScreenShare();
      say("You're sharing your screen.", "info");
    } else {
      await stopScreenShare();
    }
  } catch (err) {
    if (err.name !== "NotAllowedError") console.error("Screen share failed:", err);
  }
}

async function stopScreenShare() {
  if (!sharingScreen) return;
  sharingScreen = false;

  const cameraTrack = localStream?.getVideoTracks()[0];
  for (const pc of peerConnections.values()) {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
  }

  localScreenStream?.getTracks().forEach((track) => track.stop());
  localScreenStream = null;

  setLocalVideoTile();
  document.getElementById("screen-btn")?.classList.remove("active");
  if (localStream?.getVideoTracks()[0]?.enabled) {
    document.getElementById("camera-btn")?.classList.add("active");
  }
}

async function switchDevice(kind, deviceId) {
  if (!deviceId) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: kind === "audio" ? { deviceId: { exact: deviceId } } : false,
      video: kind === "video" ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : false
    });
    const newTrack = kind === "video" ? newStream.getVideoTracks()[0] : newStream.getAudioTracks()[0];
    const oldTrack = kind === "video" ? localStream.getVideoTracks()[0] : localStream.getAudioTracks()[0];

    if (oldTrack) {
      newTrack.enabled = oldTrack.enabled;
      localStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    localStream.addTrack(newTrack);

    if (!sharingScreen) {
      for (const pc of peerConnections.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === newTrack.kind);
        if (sender) await sender.replaceTrack(newTrack);
      }
      if (kind === "video") setLocalVideoTile();
    }
    if (kind === "audio") attachSpeakingMeter(uid, localStream);
    say(`Switched ${kind === "video" ? "camera" : "microphone"}.`, "success");
  } catch (err) {
    console.error(err);
    say(`Couldn't switch ${kind === "video" ? "camera" : "microphone"}.`, "error");
  }
}
document.getElementById("camera-select-live")?.addEventListener("change", (e) => switchDevice("video", e.target.value));
document.getElementById("mic-select-live")?.addEventListener("change", (e) => switchDevice("audio", e.target.value));

async function leaveStream(e) {
  e?.preventDefault();

  socket.emit("leave-room");
  peerConnections.forEach((pc) => pc.close());
  peerConnections.clear();
  speakingMeters.forEach((cleanup) => cleanup());
  speakingMeters.clear();

  localScreenStream?.getTracks().forEach((t) => t.stop());
  localStream?.getTracks().forEach((t) => t.stop());
  localScreenStream = null;
  localStream = null;

  window.location.href = "./index.html";
}

/* ------------------------------------------------------- Pre-join chips */
document.getElementById("preview-mic-btn")?.addEventListener("click", (e) => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.currentTarget.setAttribute("aria-pressed", String(track.enabled));
});
document.getElementById("preview-cam-btn")?.addEventListener("click", (e) => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.currentTarget.setAttribute("aria-pressed", String(track.enabled));
  document.getElementById("preview-video").style.visibility = track.enabled ? "visible" : "hidden";
});

/* ------------------------------------------------------------ Reactions */
document.querySelectorAll(".reactions-popover button[data-emoji]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const emoji = btn.dataset.emoji;
    if (!REACTION_EMOJI.has(emoji)) return;
    socket.emit("reaction", { emoji });
    spawnReaction(uid, emoji);
    document.getElementById("reactions-popover")?.classList.remove("open");
  });
});

socket.on("reaction", ({ uid: fromUid, displayName: fromName, emoji }) => {
  if (fromUid === uid) return;
  spawnReaction(fromUid, emoji);
  say(`${fromName || "Someone"} reacted ${emoji}`, "info", 1800);
});

function spawnReaction(fromUid, emoji) {
  const layer = document.getElementById("reactions__layer");
  if (!layer) return;

  const anchor = document.getElementById(`user-container-${fromUid}`);
  const layerRect = layer.getBoundingClientRect();
  let left = layerRect.width / 2;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    left = rect.left - layerRect.left + rect.width / 2;
  }

  const el = document.createElement("span");
  el.className = "reaction-float";
  el.textContent = emoji;
  el.style.left = `${Math.max(20, Math.min(layerRect.width - 20, left + (Math.random() * 40 - 20)))}px`;
  layer.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

/* --------------------------------------------------------------- Wire up */
document.getElementById("mic-btn")?.addEventListener("click", toggleMic);
document.getElementById("camera-btn")?.addEventListener("click", toggleCamera);
document.getElementById("screen-btn")?.addEventListener("click", toggleScreen);
document.getElementById("join-btn")?.addEventListener("click", joinStreams);
document.getElementById("leave-btn")?.addEventListener("click", leaveStream);

window.addEventListener("beforeunload", () => {
  try { socket.emit("leave-room"); } catch {}
});

initPrejoinPreview();
