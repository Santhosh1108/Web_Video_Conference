"use strict";

// Flat config (ESLint 9+). Two environments: the Node signaling server,
// and the browser-side client scripts that rely on a handful of globals
// defined inline in room.html (socket, roomId, uid, displayName).

module.exports = [
  {
    ignores: ["node_modules/**"]
  },
  {
    files: ["server.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error"
    }
  },
  {
    files: ["public/js/**/*.js", "public/check/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        location: "readonly",
        sessionStorage: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        MediaStream: "readonly",
        RTCPeerConnection: "readonly",
        RTCSessionDescription: "readonly",
        RTCIceCandidate: "readonly",
        AudioContext: "readonly",
        Uint8Array: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        performance: "readonly",
        setTimeout: "readonly",
        // Inline globals defined in room.html's page script:
        socket: "readonly",
        roomId: "readonly",
        uid: "readonly",
        displayName: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "warn",
      eqeqeq: ["warn", "smart"]
    }
  }
];
