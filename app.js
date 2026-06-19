"use strict";

const els = {
  booth: document.querySelector(".booth"),
  camera: document.getElementById("camera"),
  snapshot: document.getElementById("snapshot"),
  result: document.getElementById("result"),
  countdown: document.getElementById("countdown"),
  startCamera: document.getElementById("startCamera"),
  timer: document.getElementById("timer"),
  ringLight: document.getElementById("ringLight"),
  takePhoto: document.getElementById("takePhoto"),
  recordVideo: document.getElementById("recordVideo"),
  shareCapture: document.getElementById("shareCapture"),
  downloadCapture: document.getElementById("downloadCapture"),
  deleteCapture: document.getElementById("deleteCapture"),
  status: document.getElementById("status")
};

let stream = null;
let recorder = null;
let chunks = [];
let currentCapture = null;
let busy = false;

function setStatus(message) {
  els.status.textContent = message;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  const hasCamera = Boolean(stream);
  const hasCapture = Boolean(currentCapture);
  els.takePhoto.disabled = busy || !hasCamera;
  els.recordVideo.disabled = busy || !hasCamera || !window.MediaRecorder;
  els.shareCapture.disabled = busy || !hasCapture;
  els.deleteCapture.disabled = busy || !hasCapture;
  els.startCamera.disabled = busy;

  els.downloadCapture.classList.toggle("disabled", busy || !hasCapture);
  els.downloadCapture.setAttribute("aria-disabled", String(busy || !hasCapture));
}

function clearCapture() {
  if (currentCapture) URL.revokeObjectURL(currentCapture.url);
  currentCapture = null;
  els.result.replaceChildren();
  els.result.classList.add("hidden");
  els.downloadCapture.removeAttribute("href");
  els.downloadCapture.removeAttribute("download");
  setBusy(false);
}

async function startCamera() {
  clearCapture();
  setBusy(true);

  try {
    if (stream) stream.getTracks().forEach((track) => track.stop());

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: true
    });

    els.camera.srcObject = stream;
    await els.camera.play();
    els.startCamera.textContent = "Restart Camera";
    setStatus(window.MediaRecorder ? "Ready." : "Ready for photos. Video recording is not supported in this browser.");
  } catch (error) {
    setStatus("Camera blocked. Open this over HTTPS or localhost, then allow camera access.");
  } finally {
    setBusy(false);
  }
}

async function runTimer() {
  const seconds = Number(els.timer.value);
  if (!seconds) return;

  els.countdown.classList.remove("hidden");
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    els.countdown.textContent = String(remaining);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  els.countdown.classList.add("hidden");
}

function showCapture(blob, type) {
  clearCapture();

  const extension = type === "photo" ? "jpg" : videoExtension(blob.type);
  const fileName = `wedding-booth-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  const url = URL.createObjectURL(blob);
  currentCapture = { blob, fileName, type, url };

  const media = type === "photo" ? document.createElement("img") : document.createElement("video");
  media.src = url;
  media.className = "capture";
  media.alt = type === "photo" ? "Captured photo" : "";
  if (type === "video") {
    media.controls = true;
    media.loop = true;
    media.playsInline = true;
  }

  els.result.replaceChildren(media);
  els.result.classList.remove("hidden");
  els.downloadCapture.href = url;
  els.downloadCapture.download = fileName;
  setStatus("Captured. Share, download, or delete before the next guest.");
  setBusy(false);
}

async function takePhoto() {
  if (!stream || busy) return;
  clearCapture();
  setBusy(true);
  setStatus("Get ready.");
  await runTimer();

  const video = els.camera;
  const canvas = els.snapshot;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus("Photo failed. Try again.");
      setBusy(false);
      return;
    }
    showCapture(blob, "photo");
  }, "image/jpeg", 0.92);
}

async function recordVideo() {
  if (!stream || busy || !window.MediaRecorder) return;
  clearCapture();
  setBusy(true);
  setStatus("Get ready.");
  await runTimer();

  chunks = [];
  const mimeType = pickVideoMimeType();
  recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    showCapture(blob, "video");
    recorder = null;
  };

  recorder.start();
  els.recordVideo.textContent = "Stop Video";
  els.recordVideo.disabled = false;
  setStatus("Recording. Tap Stop Video when done.");
}

function stopVideo() {
  if (!recorder) return;
  els.recordVideo.textContent = "Record Video";
  recorder.stop();
  setBusy(true);
  setStatus("Saving video.");
}

function pickVideoMimeType() {
  const types = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function videoExtension(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

async function shareCapture() {
  if (!currentCapture) return;

  const file = new File([currentCapture.blob], currentCapture.fileName, { type: currentCapture.blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Wedding photo booth",
        text: "Thanks for celebrating with us!"
      });
      setStatus("Shared.");
      return;
    } catch (error) {
      setStatus("Share canceled.");
      return;
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Wedding photo booth",
        text: "Download your capture from this booth."
      });
      return;
    } catch (error) {
      setStatus("Share canceled.");
      return;
    }
  }

  setStatus("Sharing files is not available here. Use Download.");
}

els.startCamera.addEventListener("click", startCamera);
els.takePhoto.addEventListener("click", takePhoto);
els.recordVideo.addEventListener("click", () => {
  if (recorder && recorder.state === "recording") stopVideo();
  else recordVideo();
});
els.deleteCapture.addEventListener("click", () => {
  clearCapture();
  setStatus("Deleted. Ready for the next guest.");
});
els.shareCapture.addEventListener("click", shareCapture);
els.ringLight.addEventListener("change", () => {
  els.booth.dataset.ring = els.ringLight.checked ? "on" : "off";
});

window.addEventListener("pagehide", () => {
  clearCapture();
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

setBusy(false);
