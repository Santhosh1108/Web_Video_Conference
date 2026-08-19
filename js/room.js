// Auto-scroll chat to bottom
let messagesContainer = document.getElementById("messages");
messagesContainer.scrollTop = messagesContainer.scrollHeight;

// =======================
// CHAT TOGGLE
// =======================
const chatContainer = document.getElementById("messages__container");
const chatButton = document.getElementById("chat__button");

let activeChatContainer = false;

chatButton.addEventListener("click", () => {
  if (activeChatContainer) {
    chatContainer.style.display = "none";
  } else {
    chatContainer.style.display = "block";
  }
  activeChatContainer = !activeChatContainer;
});

// =======================
// VIDEO EXPAND / SHRINK LOGIC
// =======================
let displayFrame = document.getElementById("stream__box");
let videoFrames = document.getElementsByClassName("video__container");

let userIdInDisplayFrame = null;

// Expand video when clicked
let expandVideoFrame = (e) => {
  let child = displayFrame.children[0];

  // Move existing expanded video back
  if (child) {
    document.getElementById("streams__container").appendChild(child);
  }

  displayFrame.style.display = "block";
  displayFrame.appendChild(e.currentTarget);

  userIdInDisplayFrame = e.currentTarget.id;

  // Shrink other videos
  for (let i = 0; i < videoFrames.length; i++) {
    if (videoFrames[i].id !== userIdInDisplayFrame) {
      videoFrames[i].style.height = "100px";
      videoFrames[i].style.width = "100px";
    }
  }
};

// Attach click listener to each video frame
let addVideoFrameListeners = () => {
  for (let i = 0; i < videoFrames.length; i++) {
    videoFrames[i].addEventListener("click", expandVideoFrame);
  }
};

// Call once initially
addVideoFrameListeners();

// Hide expanded display frame
let hideDisplayFrame = () => {
  userIdInDisplayFrame = null;
  displayFrame.style.display = null;

  let child = displayFrame.children[0];
  if (child) {
    document.getElementById("streams__container").appendChild(child);
  }

  // Reset all videos to normal size
  for (let i = 0; i < videoFrames.length; i++) {
    videoFrames[i].style.height = "300px";
    videoFrames[i].style.width = "300px";
  }
};

// Hide expanded frame when clicking on it
displayFrame.addEventListener("click", hideDisplayFrame);
