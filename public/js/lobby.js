(() => {
  "use strict";

  const form = document.getElementById("lobby__form");
  if (!form) return;

  const nameInput = form.name;
  const roomInput = form.room;
  const submitLabel = document.getElementById("submit-label");

  const savedName = sessionStorage.getItem("display_name");
  if (savedName) nameInput.value = savedName;

  function generateRoomCode() {
    // Short, easy to read/say out loud: 3 letters + 3 digits, e.g. "kqp-482".
    const letters = "abcdefghjkmnpqrstuvwxyz"; // no i/l/o, avoids ambiguity
    const digits = "0123456789";
    const pick = (chars, n) =>
      Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `${pick(letters, 3)}-${pick(digits, 3)}`;
  }

  function updateSubmitLabel() {
    submitLabel.textContent = roomInput.value.trim()
      ? "Continue to preview"
      : "Create a new room";
  }

  function markInvalid(input, invalid) {
    input.classList.toggle("invalid", invalid);
  }

  roomInput.addEventListener("input", updateSubmitLabel);
  updateSubmitLabel();

  nameInput.addEventListener("input", () => markInvalid(nameInput, false));

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    if (!name) {
      markInvalid(nameInput, true);
      nameInput.focus();
      return;
    }

    sessionStorage.setItem("display_name", name);

    const roomId = roomInput.value.trim() || generateRoomCode();
    const params = new URLSearchParams({ room: roomId, name });
    window.location.href = `room.html?${params.toString()}`;
  });
})();
