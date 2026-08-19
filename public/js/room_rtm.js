// Socket.IO replacement for Agora RTM.
// Handles room members and chat.

function updateMembers(members) {
  const wrapper = document.getElementById("member__list");
  const count = document.getElementById("members__count");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  members.forEach(member => {
    const item = document.createElement("div");
    item.className = "member__wrapper";
    item.id = `member__${member.uid}__wrapper`;

    const dot = document.createElement("span");
    dot.className = "green__icon";

    const name = document.createElement("p");
    name.className = "member_name";
    name.textContent = member.uid === uid
      ? `${member.displayName} (You)`
      : member.displayName;

    item.append(dot, name);
    wrapper.appendChild(item);
  });

  if (count) count.textContent = members.length;
}

function removeMemberFromDom(memberUid) {
  document.getElementById(`member__${memberUid}__wrapper`)?.remove();

  const count = document.getElementById("members__count");
  if (count) count.textContent = document.querySelectorAll(".member__wrapper").length;
}

window.removeMemberFromDom = removeMemberFromDom;
socket.on("members-updated", updateMembers);

socket.on("chat-message", ({ displayName: sender, message, uid: senderUid }) => {
  addMessageToDom(sender, message);
  if (senderUid !== uid) window.bumpUnreadChat?.();
});

function sendMessage(e) {
  e.preventDefault();

  const input = e.target.message;
  const message = input.value.trim();
  if (!message) return;

  socket.emit("chat-message", { message });
  input.value = "";
}

document.getElementById("message__form")?.addEventListener("submit", sendMessage);

function addMessageToDom(name, message) {
  const wrapper = document.getElementById("messages");
  if (!wrapper) return;

  const outer = document.createElement("div");
  outer.className = "message__wrapper";

  const body = document.createElement("div");
  body.className = "message__body";

  const author = document.createElement("strong");
  author.className = "message__author";
  author.textContent = name;

  const text = document.createElement("p");
  text.className = "message__text";
  text.textContent = message;

  body.append(author, text);
  outer.appendChild(body);
  wrapper.appendChild(outer);
  outer.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addBotMessageToDom(message) {
  const wrapper = document.getElementById("messages");
  if (!wrapper) return;

  const outer = document.createElement("div");
  outer.className = "message__wrapper";

  const body = document.createElement("div");
  body.className = "message__body__bot";

  const text = document.createElement("p");
  text.className = "message__text__bot";
  text.textContent = message;

  body.appendChild(text);
  outer.appendChild(body);
  wrapper.appendChild(outer);
  outer.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

window.addBotMessageToDom = addBotMessageToDom;
