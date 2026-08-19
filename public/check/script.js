(() => {
  "use strict";

  const video = document.getElementById("video");
  const statusEl = document.getElementById("cam-status");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const cameraSelect = document.getElementById("camera-select");
  const micSelect = document.getElementById("mic-select");
  const statsEl = document.getElementById("stream-stats");
  const resolutionEl = document.getElementById("stat-resolution");
  const fpsEl = document.getElementById("stat-fps");
  const micEl = document.getElementById("stat-mic");
  const levelBar = document.querySelector("#level-meter span");
  const toastStack = document.getElementById("toast__stack");

  let stream = null;
  let audioCtx = null;
  let meterRaf = null;

  function toast(message, kind = "info") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.dataset.kind = kind;
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast-out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, 3000);
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "cam-status" + (kind ? ` cam-status--${kind}` : "");
  }

  async function populateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const fill = (select, list, kind) => {
      const current = select.value;
      select.innerHTML = "";
      if (list.length === 0) {
        const opt = document.createElement("option");
        opt.textContent = `No ${kind} found`;
        select.appendChild(opt);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      list.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `${kind} ${i + 1}`;
        select.appendChild(opt);
      });
      if (list.some((d) => d.deviceId === current)) select.value = current;
    };
    fill(cameraSelect, devices.filter((d) => d.kind === "videoinput"), "camera");
    fill(micSelect, devices.filter((d) => d.kind === "audioinput"), "microphone");
  }

  function stopMeter() {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = null;
    if (levelBar) levelBar.style.width = "0%";
  }

  function startMeter(mediaStream) {
    stopMeter();
    const track = mediaStream.getAudioTracks()[0];
    if (!track) return;

    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (levelBar) levelBar.style.width = `${Math.min(100, Math.round(rms * 340))}%`;
      micEl.textContent = rms > 0.04 ? "Detecting sound" : "Silent";
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
  }

  function updateVideoStats() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const settings = track.getSettings();
    resolutionEl.textContent = settings.width && settings.height ? `${settings.width} × ${settings.height}` : "—";
    fpsEl.textContent = settings.frameRate ? `${Math.round(settings.frameRate)} fps` : "—";
  }

  async function startCam() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera access isn't supported in this browser.", "error");
      return;
    }

    stopCam();
    startBtn.disabled = true;
    setStatus("Requesting access…");

    try {
      const constraints = {
        video: cameraSelect.value ? { deviceId: { exact: cameraSelect.value } } : true,
        audio: micSelect.value ? { deviceId: { exact: micSelect.value } } : true
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      setStatus("Camera is working", "success");
      statsEl.hidden = false;

      await populateDevices();
      updateVideoStats();
      startMeter(stream);
      toast("Camera and mic connected.", "success");
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setStatus("Camera permission was denied. Allow camera access in your browser settings.", "error");
      } else if (err.name === "NotFoundError") {
        setStatus("No camera was found on this device.", "error");
      } else if (err.name === "OverconstrainedError") {
        setStatus("That device is unavailable — try a different camera/mic.", "error");
      } else {
        setStatus(`Could not access camera: ${err.message}`, "error");
      }
      toast("Couldn't start the camera test.", "error");
    } finally {
      startBtn.disabled = false;
    }
  }

  function stopCam() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    stopMeter();
    statsEl.hidden = true;
    setStatus("Camera stopped.");
  }

  startBtn.addEventListener("click", startCam);
  stopBtn.addEventListener("click", stopCam);
  cameraSelect.addEventListener("change", () => { if (stream) startCam(); });
  micSelect.addEventListener("change", () => { if (stream) startCam(); });

  navigator.mediaDevices?.addEventListener?.("devicechange", populateDevices);

  document.addEventListener("DOMContentLoaded", () => {
    populateDevices();
    startCam();
  });
})();
