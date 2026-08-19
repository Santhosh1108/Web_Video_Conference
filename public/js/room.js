// Pure UI helpers: toasts, drawers, popovers, keyboard shortcuts, video focus
// mode. WebRTC signaling/media lives in room_rtc.js, chat/presence in
// room_rtm.js. Kept separate so each file has one job.

/* ---------------------------------------------------------------- Toasts */
const toastStack = document.getElementById("toast__stack");

function toast(message, kind = "info", timeout = 3200) {
  if (!toastStack) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.kind = kind;
  el.textContent = message;
  toastStack.appendChild(el);

  setTimeout(() => {
    el.classList.add("toast-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, timeout);
}
window.toast = toast;

/* ---------------------------------------------------------- Chat scroll */
const messagesContainer = document.getElementById("messages");
if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;

/* -------------------------------------------------------------- Drawers */
const chatContainer = document.getElementById("messages__container");
const chatButton = document.getElementById("chat__button");
const chatBadge = document.getElementById("chat-badge");
const membersButton = document.getElementById("members__button");

let unreadChat = 0;
function setChatBadge(n) {
  unreadChat = n;
  if (!chatBadge) return;
  chatBadge.hidden = n <= 0;
  chatBadge.textContent = n > 9 ? "9+" : String(n);
}
window.bumpUnreadChat = () => {
  if (!document.body.classList.contains("chat-open")) setChatBadge(unreadChat + 1);
};

if (chatButton && chatContainer) {
  chatButton.addEventListener("click", () => {
    const opening = !document.body.classList.contains("chat-open");
    document.body.classList.toggle("chat-open");
    document.body.classList.remove("members-open");
    if (opening) setChatBadge(0);
  });
}

if (membersButton) {
  membersButton.addEventListener("click", () => {
    document.body.classList.toggle("members-open");
    document.body.classList.remove("chat-open");
  });
}

document.addEventListener("click", (event) => {
  if (window.innerWidth > 1100) return;
  const clickedDrawer =
    event.target.closest("#members__container") ||
    event.target.closest("#messages__container");
  const clickedButton =
    event.target.closest("#members__button") ||
    event.target.closest("#chat__button");

  if (!clickedDrawer && !clickedButton) {
    document.body.classList.remove("members-open", "chat-open");
  }
});

/* ------------------------------------------------------------- Popovers */
function wirePopover(triggerId, popoverId) {
  const trigger = document.getElementById(triggerId);
  const popover = document.getElementById(popoverId);
  if (!trigger || !popover) return;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !popover.classList.contains("open");
    document.querySelectorAll(".reactions-popover.open,.settings-popover.open")
      .forEach((p) => p.classList.remove("open"));
    popover.classList.toggle("open", willOpen);
  });

  popover.addEventListener("click", (e) => e.stopPropagation());
}
wirePopover("reactions-btn", "reactions-popover");
wirePopover("settings-btn", "settings-popover");

document.addEventListener("click", () => {
  document.querySelectorAll(".reactions-popover.open,.settings-popover.open")
    .forEach((p) => p.classList.remove("open"));
});

/* --------------------------------------------------- Video focus mode */
const displayFrame = document.getElementById("stream__box");
const streamsContainer = document.getElementById("streams__container");
let userIdInDisplayFrame = null;

function expandVideoFrame(event) {
  const frame = event.target.closest(".video__container");
  if (!frame || !streamsContainer || !displayFrame) return;

  if (userIdInDisplayFrame === frame.id) {
    hideDisplayFrame();
    return;
  }

  const previous = displayFrame.querySelector(".video__container");
  if (previous) streamsContainer.appendChild(previous);

  displayFrame.style.display = "block";
  displayFrame.appendChild(frame);
  userIdInDisplayFrame = frame.id;

  streamsContainer.querySelectorAll(".video__container").forEach((item) => {
    item.style.opacity = ".82";
  });
}

function hideDisplayFrame() {
  if (!displayFrame || !streamsContainer) return;

  const child = displayFrame.querySelector(".video__container");
  if (child) streamsContainer.prepend(child);

  displayFrame.style.display = "none";
  userIdInDisplayFrame = null;
  document.body.classList.remove("focus-fullscreen");

  streamsContainer.querySelectorAll(".video__container").forEach((item) => {
    item.style.opacity = "1";
  });
}

streamsContainer?.addEventListener("click", expandVideoFrame);
displayFrame?.addEventListener("click", (e) => {
  // Don't collapse when the click was just toggling fullscreen etc.
  if (e.target.closest("button")) return;
  hideDisplayFrame();
});

window.addEventListener("resize", () => {
  if (window.innerWidth <= 700 && userIdInDisplayFrame) hideDisplayFrame();
});

/* ---------------------------------------------------------- Fullscreen */
const fullscreenBtn = document.getElementById("fullscreen-btn");
fullscreenBtn?.addEventListener("click", () => toggleFullscreen());

function toggleFullscreen() {
  if (!displayFrame || displayFrame.style.display === "none") {
    toast("Click a video tile to focus it, then use fullscreen.", "info");
    return;
  }
  if (!document.fullscreenElement) {
    displayFrame.requestFullscreen?.().catch(() => {
      toast("Fullscreen isn't available in this browser.", "error");
    });
  } else {
    document.exitFullscreen?.();
  }
}

/* ------------------------------------------------------ Keyboard shortcuts */
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.body.classList.remove("members-open", "chat-open");
    document.querySelectorAll(".reactions-popover.open,.settings-popover.open")
      .forEach((p) => p.classList.remove("open"));
    hideDisplayFrame();
    return;
  }

  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key.toLowerCase();
  if (key === "m") document.getElementById("mic-btn")?.click();
  else if (key === "v") document.getElementById("camera-btn")?.click();
  else if (key === "s") document.getElementById("screen-btn")?.click();
  else if (key === "f") toggleFullscreen();
  else if (key === "r") document.getElementById("reactions-btn")?.click();
});

window.__meetflowUI = { hideDisplayFrame, toggleFullscreen };
