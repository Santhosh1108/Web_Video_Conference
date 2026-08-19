// KNOWN TRADE-OFF: the App ID is exposed client-side because this project
// has no backend to generate temporary RTC/RTM tokens. That's acceptable
// for a demo/portfolio project, but for production the App ID + a
// short-lived token should be issued by a server per session (see Agora's
// token server docs) instead of being embedded in the bundle. Flagging
// this explicitly rather than silently shipping it is the correct call
// when you don't have time to stand up a token server.
const APP_ID = "270a0b5c5c92445ba2014ebfae9bb562"; // 🔴 PUT YOUR REAL AGORA APP ID HERE

let uid = sessionStorage.getItem("uid");
if (!uid) {
  uid = String(Math.floor(Math.random() * 10000));
  sessionStorage.setItem("uid", uid);
}

let token = null;
let client;

// RTM
let rtmClient;
let channel;

// URL params
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
let roomId = urlParams.get("room");
let displayName = sessionStorage.getItem("display_name");

if (!roomId) roomId = "main";
if (!displayName) window.location = "lobby.html";

// RTC
let localTracks = [];
let remoteUsers = {};

let localScreenTracks;
let sharingScreen = false;

// =======================
// DISABLE / ENABLE CONTROLS
// =======================
const disableControls = (state) => {
  document.getElementById("mic-btn").disabled = state;
  document.getElementById("camera-btn").disabled = state;
  document.getElementById("screen-btn").disabled = state;
};

// =======================
// JOIN ROOM INIT
// =======================
let joinRoomInit = async () => {
  // RTM
  rtmClient = AgoraRTM.createInstance(APP_ID);
  await rtmClient.login({ uid, token });
  await rtmClient.addOrUpdateLocalUserAttributes({ name: displayName });

  channel = rtmClient.createChannel(roomId);
  await channel.join();

  channel.on("MemberJoined", handleMemberJoined);
  channel.on("MemberLeft", handleMemberLeft);
  channel.on("ChannelMessage", handleChannelMessage);

  getMembers();
  addBotMessageToDom(`Welcome to the room ${displayName} 👋`);

  // RTC
  client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  await client.join(APP_ID, roomId, token, uid);

  client.on("user-published", handleUserPublished);
  client.on("user-left", handleUserLeft);

  // ADDED: the original code had no feedback if the network dropped —
  // participants would just silently stop seeing/hearing others with no
  // indication of why. Surface reconnect attempts and failures instead.
  client.on("connection-state-change", (curState, prevState, reason) => {
    if (curState === "RECONNECTING") {
      addBotMessageToDom("⚠️ Connection lost. Reconnecting...");
    } else if (curState === "CONNECTED" && prevState === "RECONNECTING") {
      addBotMessageToDom("✅ Reconnected.");
    } else if (curState === "DISCONNECTED" && reason !== "LEAVE") {
      addBotMessageToDom("❌ Connection lost and could not be restored. Try rejoining the room.");
    }
  });
};

// =======================
// JOIN STREAM
// =======================
let joinStreams = async () => {
  const joinBtn = document.getElementById("join-btn");
  const originalBtnText = joinBtn.textContent;
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining...";

  // FIXED: if the browser denies camera/mic permission, has no devices,
  // or another app is already using the camera, createMicrophoneAndCameraTracks
  // throws. The original code had no try/catch here, so the Join button
  // stayed visible+clickable but silently did nothing on failure (or threw
  // an uncaught error in the console) with zero feedback to the user.
  try {
    localTracks = await AgoraRTC.createMicrophoneAndCameraTracks(
      {},
      {
        encoderConfig: {
          width: { min: 640, ideal: 1280, max: 1920 },
          height: { min: 480, ideal: 720, max: 1080 },
        },
      }
    );
  } catch (err) {
    joinBtn.disabled = false;
    joinBtn.textContent = originalBtnText;

    let message = "Could not access camera/microphone.";
    if (err.code === "PERMISSION_DENIED" || err.name === "NotAllowedError") {
      message = "Camera/microphone permission denied. Please allow access and try again.";
    } else if (err.code === "DEVICE_NOT_FOUND" || err.name === "NotFoundError") {
      message = "No camera or microphone found on this device.";
    } else if (err.name === "NotReadableError") {
      message = "Your camera/microphone is already in use by another application.";
    }

    addBotMessageToDom(`⚠️ ${message}`);
    console.error("joinStreams failed:", err);
    return;
  }

  joinBtn.style.display = "none";
  document.getElementsByClassName("stream__actions")[0].style.display = "flex";

  let player = `
    <div class="video__container" id="user-container-${uid}">
      <div class="video-player" id="user-${uid}"></div>
    </div>
  `;

  document
    .getElementById("streams__container")
    .insertAdjacentHTML("beforeend", player);

  document
    .getElementById(`user-container-${uid}`)
    .addEventListener("click", expandVideoFrame);

  localTracks[1].play(`user-${uid}`);

  try {
    await client.publish(localTracks);
  } catch (err) {
    addBotMessageToDom("⚠️ Failed to publish your stream. Check your connection and try rejoining.");
    console.error("client.publish failed:", err);
    return;
  }

  // ENABLE CONTROLS AFTER TRACKS EXIST
  disableControls(false);
};

// =======================
// REMOTE USERS
// =======================
let handleUserPublished = async (user, mediaType) => {
  remoteUsers[user.uid] = user;
  await client.subscribe(user, mediaType);

  let player = document.getElementById(`user-container-${user.uid}`);
  if (!player) {
    player = `
      <div class="video__container" id="user-container-${user.uid}">
        <div class="video-player" id="user-${user.uid}"></div>
      </div>
    `;
    document
      .getElementById("streams__container")
      .insertAdjacentHTML("beforeend", player);

    document
      .getElementById(`user-container-${user.uid}`)
      .addEventListener("click", expandVideoFrame);
  }

  if (mediaType === "video") {
    user.videoTrack.play(`user-${user.uid}`);
  }
  if (mediaType === "audio") {
    user.audioTrack.play();
  }
};

let handleUserLeft = async (user) => {
  delete remoteUsers[user.uid];
  let item = document.getElementById(`user-container-${user.uid}`);
  if (item) item.remove();

  if (userIdInDisplayFrame === `user-container-${user.uid}`) {
    displayFrame.style.display = null;
  }
};

// =======================
// CONTROLS
// =======================
let toggleMic = async (e) => {
  if (!localTracks[0]) return;

  let button = e.currentTarget;
  if (localTracks[0].muted) {
    await localTracks[0].setMuted(false);
    button.classList.add("active");
  } else {
    await localTracks[0].setMuted(true);
    button.classList.remove("active");
  }
};

let toggleCamera = async (e) => {
  if (!localTracks[1]) return;

  let button = e.currentTarget;
  if (localTracks[1].muted) {
    await localTracks[1].setMuted(false);
    button.classList.add("active");
  } else {
    await localTracks[1].setMuted(true);
    button.classList.remove("active");
  }
};

// =======================
// SCREEN SHARE
// =======================
let toggleScreen = async (e) => {
  if (!localTracks[1]) return;

  let screenButton = e.currentTarget;
  let cameraButton = document.getElementById("camera-btn");

  if (!sharingScreen) {
    sharingScreen = true;

    screenButton.classList.add("active");
    cameraButton.classList.remove("active");
    cameraButton.style.display = "none";

    localScreenTracks = await AgoraRTC.createScreenVideoTrack();
    await client.unpublish(localTracks[1]);
    await client.publish(localScreenTracks);

    localScreenTracks.play(`user-${uid}`);
  } else {
    sharingScreen = false;

    cameraButton.style.display = "block";
    screenButton.classList.remove("active");

    await client.unpublish(localScreenTracks);
    await client.publish(localTracks[1]);

    localTracks[1].play(`user-${uid}`);
  }
};

// =======================
// LEAVE STREAM
// =======================
let leaveStream = async (e) => {
  e.preventDefault();

  for (let track of localTracks) {
    track.stop();
    track.close();
  }

  if (localScreenTracks) {
    localScreenTracks.stop();
    localScreenTracks.close();
  }

  await client.leave();
  window.location = "lobby.html";
};

// =======================
// EVENT LISTENERS
// =======================
document.getElementById("mic-btn").addEventListener("click", toggleMic);
document.getElementById("camera-btn").addEventListener("click", toggleCamera);
document.getElementById("screen-btn").addEventListener("click", toggleScreen);
document.getElementById("join-btn").addEventListener("click", joinStreams);
document.getElementById("leave-btn").addEventListener("click", leaveStream);

// =======================
// INIT
// =======================
disableControls(true);
joinRoomInit();
