// Native WebRTC media/signaling layer.
// Agora is intentionally not used anywhere in this file.

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

let localStream = null;
let localScreenStream = null;
let sharingScreen = false;
const peerConnections = new Map();
const remoteUsers = new Map();
const pendingCandidates = new Map();

function ensureVideoElement(uid, displayName = "Participant") {
  const existing = document.getElementById(`user-container-${uid}`);
  if (existing) return existing;

  const wrapper = document.createElement("div");
  wrapper.className = "video__container";
  wrapper.id = `user-container-${uid}`;
  wrapper.dataset.uid = uid;

  const video = document.createElement("video");
  video.className = "video-player";
  video.id = `user-${uid}`;
  video.autoplay = true;
  video.playsInline = true;

  const label = document.createElement("div");
  label.className = "video__name";
  label.textContent = displayName;

  wrapper.appendChild(video);
  wrapper.appendChild(label);
  document.getElementById("streams__container").appendChild(wrapper);
  return wrapper;
}

function removeVideo(uid) {
  const el = document.getElementById(`user-container-${uid}`);
  if (el) el.remove();
}

function setLocalVideo(stream) {
  const wrapper = ensureVideoElement(uid, `${displayName} (You)`);
  const video = wrapper.querySelector("video");
  video.muted = true;
  video.srcObject = stream;
  video.play().catch(() => {});
}

async function createPeer(user, initiator) {
  if (peerConnections.has(user.socketId)) {
    return peerConnections.get(user.socketId);
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections.set(user.socketId, pc);
  remoteUsers.set(user.socketId, user);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    const wrapper = ensureVideoElement(user.uid, user.displayName);
    const video = wrapper.querySelector("video");
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: user.socketId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      if (pc.connectionState === "failed") {
        pc.restartIce?.();
      }
    }
  };

  if (initiator) {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await pc.setLocalDescription(offer);
    socket.emit("offer", { target: user.socketId, offer: pc.localDescription });
  }

  return pc;
}

async function startLocalMedia() {
  if (localStream) return localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });

    setLocalVideo(localStream);
    return localStream;
  } catch (err) {
    console.error(err);
    addBotMessageToDom?.(
      err.name === "NotAllowedError"
        ? "Camera/microphone permission was denied."
        : "Could not access camera/microphone."
    );
    throw err;
  }
}

async function joinStreams() {
  const joinBtn = document.getElementById("join-btn");
  if (!joinBtn) return;

  joinBtn.disabled = true;
  joinBtn.textContent = "Starting...";

  try {
    await startLocalMedia();

    joinBtn.style.display = "none";
    const actions = document.querySelector(".stream__actions");
    if (actions) actions.style.display = "flex";

    disableControls(false);

    // Tell the server we are ready. Existing users will receive offers.
    socket.emit("join-room", { roomId, uid, displayName });

    addBotMessageToDom?.(`Connected to room "${roomId}".`);
  } catch {
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Stream";
  }
}

socket.on("room-users", async (users) => {
  for (const user of users) {
    await createPeer(user, true);
  }
});

socket.on("user-joined", async (user) => {
  await createPeer(user, true);
  addBotMessageToDom?.(`${user.displayName} joined the room 👋`);
});

socket.on("offer", async ({ from, uid: remoteUid, displayName: remoteName, offer }) => {
  const user = { socketId: from, uid: remoteUid, displayName: remoteName };
  const pc = await createPeer(user, false);

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const queued = pendingCandidates.get(from) || [];
  for (const candidate of queued) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
  }
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
  for (const candidate of queued) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
  }
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
  const pc = peerConnections.get(socketId);
  if (pc) pc.close();

  peerConnections.delete(socketId);
  remoteUsers.delete(socketId);
  pendingCandidates.delete(socketId);
  removeVideo(remoteUid);
  removeMemberFromDom?.(remoteUid);
  addBotMessageToDom?.(`${remoteName || "A participant"} left the room.`);
});

async function toggleMic(e) {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  e.currentTarget.classList.toggle("active", track.enabled);
  socket.emit("media-state", { type: "audio", enabled: track.enabled });
}

async function toggleCamera(e) {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  e.currentTarget.classList.toggle("active", track.enabled);
  socket.emit("media-state", { type: "video", enabled: track.enabled });
}

async function toggleScreen(e) {
  if (!localStream) return;

  const screenButton = e.currentTarget;
  const cameraButton = document.getElementById("camera-btn");
  const cameraTrack = localStream.getVideoTracks()[0];

  try {
    if (!sharingScreen) {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false
      });

      const screenTrack = localScreenStream.getVideoTracks()[0];
      sharingScreen = true;

      for (const pc of peerConnections.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(screenTrack);
      }

      const wrapper = ensureVideoElement(uid, `${displayName} (You)`);
      wrapper.querySelector("video").srcObject = localScreenStream;
      screenButton.classList.add("active");
      cameraButton?.classList.remove("active");

      screenTrack.onended = () => stopScreenShare();
    } else {
      await stopScreenShare();
    }
  } catch (err) {
    console.error("Screen share failed:", err);
  }
}

async function stopScreenShare() {
  if (!sharingScreen) return;

  sharingScreen = false;
  const cameraTrack = localStream?.getVideoTracks()[0];

  for (const pc of peerConnections.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
  }

  localScreenStream?.getTracks().forEach(track => track.stop());
  localScreenStream = null;

  setLocalVideo(localStream);

  document.getElementById("screen-btn")?.classList.remove("active");
  document.getElementById("camera-btn")?.classList.add("active");
}

async function leaveStream(e) {
  e?.preventDefault();

  socket.emit("leave-room");

  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();

  localScreenStream?.getTracks().forEach(t => t.stop());
  localStream?.getTracks().forEach(t => t.stop());

  localScreenStream = null;
  localStream = null;

  window.location.href = "./index.html";
}

document.getElementById("mic-btn")?.addEventListener("click", toggleMic);
document.getElementById("camera-btn")?.addEventListener("click", toggleCamera);
document.getElementById("screen-btn")?.addEventListener("click", toggleScreen);
document.getElementById("join-btn")?.addEventListener("click", joinStreams);
document.getElementById("leave-btn")?.addEventListener("click", leaveStream);

window.addEventListener("beforeunload", () => {
  try { socket.emit("leave-room"); } catch {}
});
