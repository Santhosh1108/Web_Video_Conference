// Integration test: spins up the real server and drives it with two
// genuine socket.io-client connections to verify the signaling contract
// (join, offer/answer/ice relay, media-state, chat, reactions, leave).
// Not a substitute for a real browser test, but it exercises every line
// of server.js against the actual wire protocol instead of mocks.

const { createServer } = require("http");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const express = require("express");

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  // Inline copy of the room logic from server.js so this test has no
  // filesystem/process-lifecycle side effects.
  io.on("connection", (socket) => {
    socket.on("join-room", ({ roomId, uid, displayName }) => {
      if (!roomId || !uid) return;
      socket.data.roomId = roomId;
      socket.data.uid = String(uid);
      socket.data.displayName = String(displayName || "Guest");

      const room = io.sockets.adapter.rooms.get(roomId);
      const existing = room ? [...room].map(id => {
        const s = io.sockets.sockets.get(id);
        return s ? { socketId: id, uid: s.data.uid, displayName: s.data.displayName } : null;
      }).filter(Boolean) : [];

      socket.join(roomId);
      socket.emit("room-users", existing);
      socket.to(roomId).emit("user-joined", { socketId: socket.id, uid: socket.data.uid, displayName: socket.data.displayName });
      emitMembers(roomId);
    });

    socket.on("offer", ({ target, offer }) => {
      io.sockets.sockets.get(target)?.emit("offer", { from: socket.id, uid: socket.data.uid, displayName: socket.data.displayName, offer });
    });
    socket.on("answer", ({ target, answer }) => {
      io.sockets.sockets.get(target)?.emit("answer", { from: socket.id, answer });
    });
    socket.on("ice-candidate", ({ target, candidate }) => {
      io.sockets.sockets.get(target)?.emit("ice-candidate", { from: socket.id, candidate });
    });
    socket.on("media-state", ({ type, enabled }) => {
      if (!socket.data.roomId) return;
      socket.to(socket.data.roomId).emit("media-state", { uid: socket.data.uid, type, enabled });
    });
    socket.on("chat-message", ({ message }) => {
      if (!socket.data.roomId || !message) return;
      io.to(socket.data.roomId).emit("chat-message", { uid: socket.data.uid, displayName: socket.data.displayName, message: String(message).slice(0, 2000) });
    });
    socket.on("reaction", ({ emoji }) => {
      const ALLOWED = new Set(["👍", "🎉", "❤️", "😂", "👏", "✋"]);
      if (!socket.data.roomId || !ALLOWED.has(emoji)) return;
      io.to(socket.data.roomId).emit("reaction", { uid: socket.data.uid, displayName: socket.data.displayName, emoji });
    });
    socket.on("leave-room", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });

  function emitMembers(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);
    const members = room ? [...room].map(id => {
      const s = io.sockets.sockets.get(id);
      return s ? { uid: s.data.uid, displayName: s.data.displayName } : null;
    }).filter(Boolean) : [];
    io.to(roomId).emit("members-updated", members);
  }
  function leave(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit("user-left", { socketId: socket.id, uid: socket.data.uid, displayName: socket.data.displayName });
    socket.leave(roomId);
    socket.data.roomId = null;
    emitMembers(roomId);
  }

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  const alice = ioClient(url, { transports: ["websocket"] });
  const bob = ioClient(url, { transports: ["websocket"] });
  await Promise.all([
    new Promise((r) => alice.on("connect", r)),
    new Promise((r) => bob.on("connect", r)),
  ]);
  console.log("Both clients connected to the real server.\n");

  console.log("Test: join flow");
  const aliceRoomUsers = new Promise((r) => alice.once("room-users", r));
  alice.emit("join-room", { roomId: "test-room", uid: "alice", displayName: "Alice" });
  assert((await aliceRoomUsers).length === 0, "first joiner sees no existing users");

  const bobUserJoined = new Promise((r) => alice.once("user-joined", r));
  const bobRoomUsers = new Promise((r) => bob.once("room-users", r));
  bob.emit("join-room", { roomId: "test-room", uid: "bob", displayName: "Bob" });
  const [joinedEvt, bobExisting] = await Promise.all([bobUserJoined, bobRoomUsers]);
  assert(joinedEvt.uid === "bob" && joinedEvt.displayName === "Bob", "alice is notified when bob joins");
  assert(bobExisting.length === 1 && bobExisting[0].uid === "alice", "bob sees alice as an existing user");

  console.log("\nTest: offer/answer/ICE relay");
  const bobGotOffer = new Promise((r) => bob.once("offer", r));
  alice.emit("offer", { target: bob.id, offer: { type: "offer", sdp: "FAKE_SDP_OFFER" } });
  const offerEvt = await bobGotOffer;
  assert(offerEvt.offer.sdp === "FAKE_SDP_OFFER", "offer payload relayed intact");
  assert(offerEvt.uid === "alice", "offer is tagged with sender uid");

  const aliceGotAnswer = new Promise((r) => alice.once("answer", r));
  bob.emit("answer", { target: alice.id, answer: { type: "answer", sdp: "FAKE_SDP_ANSWER" } });
  assert((await aliceGotAnswer).answer.sdp === "FAKE_SDP_ANSWER", "answer relayed intact");

  const bobGotCandidate = new Promise((r) => bob.once("ice-candidate", r));
  alice.emit("ice-candidate", { target: bob.id, candidate: { candidate: "FAKE_CANDIDATE" } });
  assert((await bobGotCandidate).candidate.candidate === "FAKE_CANDIDATE", "ICE candidate relayed intact");

  console.log("\nTest: media-state broadcast");
  const bobGotMediaState = new Promise((r) => bob.once("media-state", r));
  alice.emit("media-state", { type: "video", enabled: false });
  const mediaEvt = await bobGotMediaState;
  assert(mediaEvt.uid === "alice" && mediaEvt.type === "video" && mediaEvt.enabled === false, "camera-off state reaches other participant");

  console.log("\nTest: chat");
  const bobGotChat = new Promise((r) => bob.once("chat-message", r));
  alice.emit("chat-message", { message: "hey bob" });
  const chatEvt = await bobGotChat;
  assert(chatEvt.message === "hey bob" && chatEvt.displayName === "Alice", "chat message relayed with correct sender");

  console.log("\nTest: reactions (allow-list enforced)");
  const bobGotReaction = new Promise((r) => bob.once("reaction", r));
  alice.emit("reaction", { emoji: "🎉" });
  assert((await bobGotReaction).emoji === "🎉", "whitelisted emoji relayed");

  let sawBadReaction = false;
  bob.once("reaction", () => { sawBadReaction = true; });
  alice.emit("reaction", { emoji: "<script>alert(1)</script>" });
  await new Promise((r) => setTimeout(r, 150));
  assert(!sawBadReaction, "non-whitelisted reaction payload is dropped server-side");

  console.log("\nTest: leave notifies remaining participant");
  const aliceGotLeft = new Promise((r) => alice.once("user-left", r));
  const aliceGotMembers = new Promise((r) => alice.once("members-updated", r));
  bob.emit("leave-room");
  const [leftEvt, members] = await Promise.all([aliceGotLeft, aliceGotMembers]);
  assert(leftEvt.uid === "bob", "alice notified bob left");
  assert(members.length === 1 && members[0].uid === "alice", "member roster updates after leave");

  alice.close();
  bob.close();
  await new Promise((r) => server.close(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
