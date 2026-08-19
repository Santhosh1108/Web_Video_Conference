// Responsive meeting UI helpers. WebRTC signaling/media lives in room_rtc.js.

const messagesContainer = document.getElementById("messages");
if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;

const chatContainer = document.getElementById("messages__container");
const chatButton = document.getElementById("chat__button");

if (chatButton && chatContainer) {
  chatButton.addEventListener("click", () => {
    document.body.classList.toggle("chat-open");
    document.body.classList.remove("members-open");
  });
}

// Optional participant drawer button if added to the HTML.
const membersButton = document.getElementById("members__button");
if (membersButton) {
  membersButton.addEventListener("click", () => {
    document.body.classList.toggle("members-open");
    document.body.classList.remove("chat-open");
  });
}

// Click outside a mobile drawer to close it.
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

// Escape closes drawers / focused video.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.body.classList.remove("members-open", "chat-open");
    hideDisplayFrame();
  }
});

// Video focus mode. Uses event delegation so dynamically-created WebRTC
// video cards work without repeatedly attaching listeners.
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

  streamsContainer.querySelectorAll(".video__container").forEach((item) => {
    item.style.opacity = "1";
  });
}

streamsContainer?.addEventListener("click", expandVideoFrame);
displayFrame?.addEventListener("click", hideDisplayFrame);

// Keep the focused frame usable after a resize.
window.addEventListener("resize", () => {
  if (window.innerWidth <= 700 && userIdInDisplayFrame) {
    hideDisplayFrame();
  }
});
