const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, uid, displayName }) => {
    if (!roomId || !uid) return;

    socket.data.roomId = roomId;
    socket.data.uid = String(uid);
    socket.data.displayName = String(displayName || "Guest");

    const room = io.sockets.adapter.rooms.get(roomId);
    const existingUsers = room ? [...room].map(id => {
      const s = io.sockets.sockets.get(id);
      return s ? {
        socketId: id,
        uid: s.data.uid,
        displayName: s.data.displayName
      } : null;
    }).filter(Boolean) : [];

    socket.join(roomId);

    socket.emit("room-users", existingUsers);
    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
      uid: socket.data.uid,
      displayName: socket.data.displayName
    });

    emitMembers(roomId);
  });

  socket.on("offer", ({ target, offer }) => {
    const targetSocket = io.sockets.sockets.get(target);
    if (targetSocket) {
      targetSocket.emit("offer", {
        from: socket.id,
        uid: socket.data.uid,
        displayName: socket.data.displayName,
        offer
      });
    }
  });

  socket.on("answer", ({ target, answer }) => {
    const targetSocket = io.sockets.sockets.get(target);
    if (targetSocket) {
      targetSocket.emit("answer", {
        from: socket.id,
        answer
      });
    }
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    const targetSocket = io.sockets.sockets.get(target);
    if (targetSocket) {
      targetSocket.emit("ice-candidate", {
        from: socket.id,
        candidate
      });
    }
  });

  socket.on("media-state", ({ type, enabled }) => {
    if (!socket.data.roomId) return;
    socket.to(socket.data.roomId).emit("media-state", {
      uid: socket.data.uid,
      type,
      enabled
    });
  });

  socket.on("chat-message", ({ message }) => {
    if (!socket.data.roomId || !message) return;
    io.to(socket.data.roomId).emit("chat-message", {
      uid: socket.data.uid,
      displayName: socket.data.displayName,
      message: String(message).slice(0, 2000)
    });
  });

  socket.on("leave-room", () => {
    leave(socket);
  });

  socket.on("disconnect", () => {
    leave(socket);
  });
});

function emitMembers(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  const members = room ? [...room].map(id => {
    const s = io.sockets.sockets.get(id);
    return s ? {
      uid: s.data.uid,
      displayName: s.data.displayName
    } : null;
  }).filter(Boolean) : [];

  io.to(roomId).emit("members-updated", members);
}

function leave(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  socket.to(roomId).emit("user-left", {
    socketId: socket.id,
    uid: socket.data.uid,
    displayName: socket.data.displayName
  });

  socket.leave(roomId);
  socket.data.roomId = null;
  emitMembers(roomId);
}

server.listen(PORT, () => {
  console.log(`WebRTC server running at http://localhost:${PORT}`);
});
