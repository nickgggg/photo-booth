"use strict";

const els = {
  booth: document.querySelector(".booth"),
  controls: document.querySelector(".controls"),
  liveOverlays: document.getElementById("liveOverlays"),
  cameraWelcome: document.getElementById("cameraWelcome"),
  cameraMessage: document.getElementById("cameraMessage"),
  stickerTools: document.getElementById("stickerTools"),
  resizeSticker: document.getElementById("resizeSticker"),
  retakeCapture: document.getElementById("retakeCapture"),
  nextGuest: document.getElementById("nextGuest"),
  recordingIndicator: document.getElementById("recordingIndicator"),
  recordingTime: document.getElementById("recordingTime"),
  stage: document.getElementById("stage"),
  camera: document.getElementById("camera"),
  snapshot: document.getElementById("snapshot"),
  stickersLayer: document.getElementById("stickersLayer"),
  result: document.getElementById("result"),
  countdown: document.getElementById("countdown"),
  startCamera: document.getElementById("startCamera"),
  refreshApp: document.getElementById("refreshApp"),
  timer: document.getElementById("timer"),
  rotateCameraLeft: document.getElementById("rotateCameraLeft"),
  rotateCameraRight: document.getElementById("rotateCameraRight"),
  ringLightButton: document.getElementById("ringLightButton"),
  logoOverlay: document.getElementById("logoOverlay"),
  openStickerPicker: document.getElementById("openStickerPicker"),
  closeStickerPicker: document.getElementById("closeStickerPicker"),
  stickerPicker: document.getElementById("stickerPicker"),
  stickerChoiceCount: document.getElementById("stickerChoiceCount"),
  rotateSticker: document.getElementById("rotateSticker"),
  removeSticker: document.getElementById("removeSticker"),
  photoBooth: document.getElementById("photoBooth"),
  confessionalMode: document.getElementById("confessionalMode"),
  confessionalPicker: document.getElementById("confessionalPicker"),
  closeConfessionalPicker: document.getElementById("closeConfessionalPicker"),
  shareCapture: document.getElementById("shareCapture"),
  adminPanel: document.getElementById("adminPanel"),
  exportArchive: document.getElementById("exportArchive"),
  archiveCount: document.getElementById("archiveCount"),
  status: document.getElementById("status"),
};

const DB_NAME = "brixpix-archive";
const DB_VERSION = 1;
const STORE_NAME = "photos";
const DEFAULT_UPLOAD_ENDPOINT =
  "https://script.google.com/macros/s/AKfycby2mTliV2bwMCL7y_N4RgBidcAF9aNHouUjzp2dTZ8u1yzjnaqqZHEfkn2Xk67BSgbc/exec";
const UPLOAD_VERIFICATION_KEY = "brixpixVerifiedUploadsV1";
const UPLOAD_RETRY_MS = 30000;
const VIDEO_MAX_MS = 15000;
const VIDEO_BITS_PER_SECOND = 2000000;
const AUDIO_BITS_PER_SECOND = 96000;
const VIDEO_FRAME_RATE = 15;
const VIDEO_MAX_WIDTH = 720;
const IMAGE_STICKERS = {
  brickart: { src: "stickers/brick-bn.png", width: 190, aspect: 467 / 373 },
  nickbrenna: {
    src: "stickers/nick-brenna.png",
    width: 190,
    aspect: 467 / 373,
  },
  huntingtonbeach: {
    src: "stickers/huntington-beach.png",
    width: 210,
    aspect: 1500 / 1300,
  },
  norbitcutout: {
    src: "stickers/norbit-cutout.png",
    width: 175,
    aspect: 1206 / 1305,
  },
  cat: { src: "stickers/cat.png", width: 160, aspect: 1903 / 2095 },
};
const isAdmin = (() => {
  const params = new URLSearchParams(location.search);
  if (params.has("admin")) return true;
  const rawQuery = location.search.toLowerCase();
  const rawHash = location.hash.toLowerCase();
  return (
    rawQuery.includes("admin1") ||
    rawQuery.includes("admin=true") ||
    rawHash.includes("admin")
  );
})();

let stream = null;
let recorder = null;
let chunks = [];
let videoStopTimer = null;
let videoRenderFrame = null;
let videoRenderLastTime = 0;
let recordingOutputStream = null;
let currentCapture = null;
let busy = false;
let selectedFilter = "none";
let stickers = [];
let selectedStickerId = null;
let nextStickerId = 1;
let dbPromise = null;
let cameraStarting = false;
let cameraStartPromise = null;
let microphoneStream = null;
let recordingClock = null;
let handleGesture = null;
let archiveWarning = false;
let uploadQueuePrepared = false;
let wakeLock = null;
let cameraRotation = 0;
let uploadSyncInFlight = false;
let uploadSyncRequested = false;
let uploadRetryTimer = null;
let uploadPreparationPromise = null;
let activeConfessionalPrompt = null;
const activePointers = new Map();
let gesture = null;
const stickerImages = new Map();

Object.entries(IMAGE_STICKERS).forEach(([kind, config]) => {
  const image = new Image();
  image.decoding = "async";
  image.src = config.src;
  stickerImages.set(kind, image);
});

els.stickerChoiceCount.textContent = `${document.querySelectorAll("#stickerPicker [data-sticker-choice]").length} choices`;

function setStatus(message) {
  els.status.textContent = message;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  const hasCamera = Boolean(
    stream &&
      stream.getVideoTracks().some((track) => track.readyState === "live"),
  );
  const isRecording = recorder && recorder.state === "recording";
  const hasCapture = Boolean(currentCapture);
  els.booth.classList.toggle("is-busy", busy);
  els.booth.classList.toggle("is-review", hasCapture);
  els.photoBooth.disabled = busy || !hasCamera;
  els.confessionalMode.disabled =
    (busy && !isRecording) || !hasCamera || !window.MediaRecorder;
  els.shareCapture.disabled = busy || !hasCapture;
  els.startCamera.disabled = cameraStarting;
  els.refreshApp.disabled = busy;
  els.retakeCapture.classList.toggle("hidden", !hasCapture);
  els.nextGuest.classList.toggle("hidden", !hasCapture);
  els.retakeCapture.disabled = busy;
  els.nextGuest.disabled = busy;
  els.photoBooth.querySelector("span:last-child").textContent = hasCapture
    ? "Take another"
    : "Take photo";
  els.controls
    .querySelectorAll("button, select, input")
    .forEach((control) => (control.disabled = busy || hasCapture));
  els.ringLightButton.disabled = busy && !isRecording;
  updateStickerTools();
}

function clearCapture() {
  if (currentCapture) URL.revokeObjectURL(currentCapture.url);
  currentCapture = null;
  els.stage.classList.remove("has-result");
  els.result.replaceChildren();
  els.result.classList.add("hidden");
  archiveWarning = false;
  setBusy(false);
}

async function startCamera() {
  if (cameraStartPromise) return cameraStartPromise;
  if (
    stream &&
    stream.getVideoTracks().some((track) => track.readyState === "live")
  )
    return;
  cameraStarting = true;
  setBusy(true);
  els.cameraWelcome.classList.remove("hidden");
  els.startCamera.classList.add("hidden");
  els.cameraMessage.textContent = "Starting camera…";
  cameraStartPromise = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("InsecureContext");
      const landscape = innerWidth > innerHeight;
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: landscape ? 1920 : 1080 },
          height: { ideal: landscape ? 1080 : 1920 },
        },
        audio: false,
      });
      els.camera.srcObject = stream;
      await els.camera.play();
      updateCameraLayout();

      els.cameraWelcome.classList.add("hidden");
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (recorder?.state === "recording") stopVideo();
        stopCameraStream();
        if (!recorder) setBusy(false);
        els.cameraWelcome.classList.remove("hidden");
        els.startCamera.classList.remove("hidden");
        els.cameraMessage.textContent =
          "Camera disconnected. Tap to reconnect.";
        setStatus("Camera disconnected.");
      });
      setStatus("Ready.");
      requestWakeLock();
    } catch (error) {
      stopCameraStream();
      const message = !window.isSecureContext
        ? "Camera access needs HTTPS. Open the secure site."
        : error.name === "NotAllowedError"
          ? "Allow camera access in your browser, then try again."
          : error.name === "NotFoundError"
            ? "No camera found. Connect a camera and try again."
            : "Camera unavailable. Close other camera apps, then try again.";
      els.cameraMessage.textContent = message;
      els.startCamera.textContent = "Enable camera";
      els.startCamera.classList.remove("hidden");
      setStatus(message);
    } finally {
      cameraStarting = false;
      cameraStartPromise = null;
      setBusy(false);
    }
  })();
  return cameraStartPromise;
}

function stopCameraStream() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

async function requestWakeLock() {
  try {
    if (
      document.visibilityState === "visible" &&
      navigator.wakeLock &&
      !wakeLock
    ) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    }
  } catch (_) {
    /* Guided Access remains the device fallback. */
  }
}

function cameraDimensions() {
  const rotated = Math.abs(cameraRotation) === 90;
  const width = els.camera.videoWidth || 1280;
  const height = els.camera.videoHeight || 720;
  return rotated ? { width: height, height: width } : { width, height };
}

function updateCameraLayout() {
  const stage = els.stage.getBoundingClientRect();
  const dimensions = cameraDimensions();
  const rect = mediaDisplayRect(
    stage.width,
    stage.height,
    dimensions.width,
    dimensions.height,
  );
  const factor = rect.width / dimensions.width;
  const width = (els.camera.videoWidth || 1280) * factor;
  const height = (els.camera.videoHeight || 720) * factor;
  Object.assign(els.camera.style, {
    width: `${width}px`,
    height: `${height}px`,
    left: `${(stage.width - width) / 2}px`,
    top: `${(stage.height - height) / 2}px`,
    transform: `rotate(${cameraRotation}deg)`,
  });
  Object.assign(els.liveOverlays.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  updateStickerTools();
}

function drawCameraFrame(ctx, width, height) {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((cameraRotation * Math.PI) / 180);
  const rotated = Math.abs(cameraRotation) === 90;
  ctx.drawImage(
    els.camera,
    -(rotated ? height : width) / 2,
    -(rotated ? width : height) / 2,
    rotated ? height : width,
    rotated ? width : height,
  );
  ctx.restore();
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

function timestampFileName(extension, prefix = "BRIXPIX") {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-");
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
  return `${prefix}_${date}_${time}-${pad(now.getMilliseconds(), 3)}.${extension}`;
}

function showCapture(blob, type, fileName = null, savedLocally = true) {
  clearCapture();
  archiveWarning = !savedLocally;

  const extension = type === "photo" ? "jpg" : videoExtension(blob.type);
  const captureFileName = fileName || timestampFileName(extension);
  const url = URL.createObjectURL(blob);
  currentCapture = { blob, fileName: captureFileName, type, url };

  const media =
    type === "photo"
      ? document.createElement("img")
      : document.createElement("video");
  media.src = url;
  media.className = "capture";
  media.alt = type === "photo" ? "Captured photo" : "";
  if (type === "video") {
    media.controls = true;
    media.playsInline = true;
    media.preload = "metadata";
  }

  els.result.replaceChildren(media);
  els.result.classList.remove("hidden");
  els.stage.classList.add("has-result");
  setStatus(
    archiveWarning
      ? "Capture ready. Local save failed — share or download now."
      : "Saved on this device. Share or take another.",
  );
  setBusy(false);
}

async function takePhoto() {
  if (!stream || busy) return;
  clearCapture();
  setBusy(true);
  setStatus("Get ready.");
  await runTimer();

  const canvas = els.snapshot;
  const dimensions = cameraDimensions();
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const captureFilter = filterForCanvas(selectedFilter);
  const canvasFilterApplied = typeof ctx.filter === "string";
  ctx.save();
  if (canvasFilterApplied) ctx.filter = captureFilter;
  drawCameraFrame(ctx, canvas.width, canvas.height);
  ctx.restore();
  if (captureFilter !== "none" && !canvasFilterApplied) {
    // If a browser ignored canvas filters, the fallback keeps saved photos from being unfiltered.
    applyCanvasFilter(ctx, canvas.width, canvas.height, selectedFilter);
  }
  drawPhotoOverlays(ctx, canvas.width, canvas.height);

  canvas.toBlob(
    async (blob) => {
      if (!blob) {
        setStatus("Photo failed. Try again.");
        setBusy(false);
        return;
      }
      const fileName = timestampFileName("jpg");
      const saved = await archiveCapture(blob, fileName);
      showCapture(blob, "photo", fileName, saved);
      if (!saved)
        setStatus("Photo ready. Local save failed — share or download now.");
    },
    "image/jpeg",
    0.92,
  );
}

async function recordVideo(prompt) {
  if (!stream || busy || !window.MediaRecorder) return;
  clearCapture();
  setBusy(true);
  activeConfessionalPrompt = prompt;
  setStatus("Preparing video…");

  let hasAudio = false;
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    hasAudio = true;
  } catch (_) {
    /* Recording remains available without sound. */
  }
  setStatus(
    hasAudio
      ? "Get ready."
      : "Microphone unavailable. Video will have no sound.",
  );
  await runTimer();
  chunks = [];
  const mimeType = pickVideoMimeType();
  try {
    recordingOutputStream = createCompositedVideoStream();
    recorder = createVideoRecorder(recordingOutputStream, mimeType);
  } catch (error) {
    stopVideoCompositor();
    setStatus("Video recording is not available. Refresh and try again.");
    setBusy(false);
    return;
  }
  const activeRecorder = recorder;
  let recordingFailed = false;
  activeRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  activeRecorder.onerror = () => {
    recordingFailed = true;
    clearTimeout(videoStopTimer);
    stopVideoCompositor();
    if (recorder === activeRecorder) recorder = null;
    activeConfessionalPrompt = null;
    resetVideoButton();
    setBusy(false);
    setStatus("Video recording failed. Try again.");
  };
  activeRecorder.onstop = async () => {
    clearTimeout(videoStopTimer);
    stopVideoCompositor();
    if (recordingFailed) return;
    if (!chunks.length) {
      recorder = null;
      activeConfessionalPrompt = null;
      resetVideoButton();
      setBusy(false);
      setStatus("Video was empty. Please try again.");
      return;
    }
    resetVideoButton();
    const blob = new Blob(chunks, {
      type: activeRecorder.mimeType || "video/webm",
    });
    const fileName = timestampFileName(
      videoExtension(blob.type),
      "BRIXPIX_CONFESSIONAL",
    );
    if (recorder === activeRecorder) recorder = null;
    const savedLocally = await archiveCapture(blob, fileName);
    showCapture(blob, "video", fileName, savedLocally);
    activeConfessionalPrompt = null;
    if (!savedLocally) setStatus("Video ready, but local archive save failed.");
  };

  try {
    activeRecorder.start();
  } catch (_) {
    stopVideoCompositor();
    recorder = null;
    setBusy(false);
    setStatus("Video could not start. Try again.");
    return;
  }
  const startedAt = performance.now();
  els.recordingIndicator.classList.remove("hidden");
  els.recordingTime.textContent = "00:00 / 00:15";
  recordingClock = setInterval(() => {
    els.recordingTime.textContent = `00:${String(Math.min(15, Math.floor((performance.now() - startedAt) / 1000))).padStart(2, "0")} / 00:15`;
  }, 250);
  videoStopTimer = setTimeout(stopVideo, VIDEO_MAX_MS);
  els.confessionalMode.textContent = "Stop Recording";
  els.confessionalMode.classList.add("recording");
  els.confessionalMode.disabled = false;
  setStatus(
    hasAudio
      ? "Recording. Stops at 15 seconds."
      : "Recording without sound. Microphone access was unavailable.",
  );
}

function createCompositedVideoStream() {
  const canvas = els.snapshot;
  if (typeof canvas.captureStream !== "function") {
    throw new Error("Canvas video capture is unavailable");
  }

  const dimensions = cameraDimensions();
  const scale = Math.min(
    1,
    VIDEO_MAX_WIDTH / Math.max(dimensions.width, dimensions.height),
  );
  canvas.width = Math.max(2, Math.round((dimensions.width * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.round((dimensions.height * scale) / 2) * 2);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const frameInterval = 1000 / VIDEO_FRAME_RATE;
  videoRenderLastTime = 0;

  const renderFrame = (timestamp) => {
    if (!recordingOutputStream) return;
    if (
      !videoRenderLastTime ||
      timestamp - videoRenderLastTime >= frameInterval
    ) {
      videoRenderLastTime = timestamp;
      drawCompositedVideoFrame(ctx, canvas.width, canvas.height);
    }
    videoRenderFrame = requestAnimationFrame(renderFrame);
  };

  drawCompositedVideoFrame(ctx, canvas.width, canvas.height);
  const output = canvas.captureStream(VIDEO_FRAME_RATE);
  recordingOutputStream = output;
  microphoneStream
    ?.getAudioTracks()
    .forEach((track) => output.addTrack(track.clone()));
  videoRenderFrame = requestAnimationFrame(renderFrame);
  return output;
}

function drawCompositedVideoFrame(ctx, width, height) {
  const captureFilter = filterForCanvas(selectedFilter);
  const canvasFilterApplied = typeof ctx.filter === "string";
  ctx.save();
  if (canvasFilterApplied) ctx.filter = captureFilter;
  drawCameraFrame(ctx, width, height);
  ctx.restore();
  if (captureFilter !== "none" && !canvasFilterApplied)
    applyCanvasFilter(ctx, width, height, selectedFilter);
  drawPhotoOverlays(ctx, width, height);
  if (activeConfessionalPrompt)
    drawConfessionalPrompt(ctx, width, height, activeConfessionalPrompt);
}

function stopVideoCompositor() {
  clearInterval(recordingClock);
  recordingClock = null;
  els.recordingIndicator.classList.add("hidden");
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  if (videoRenderFrame !== null) cancelAnimationFrame(videoRenderFrame);
  videoRenderFrame = null;
  videoRenderLastTime = 0;
  if (recordingOutputStream) {
    recordingOutputStream.getTracks().forEach((track) => track.stop());
    recordingOutputStream = null;
  }
}

function createVideoRecorder(recordingStream, mimeType) {
  const options = {
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  };
  if (mimeType) options.mimeType = mimeType;

  try {
    return new MediaRecorder(recordingStream, options);
  } catch (error) {
    return mimeType
      ? new MediaRecorder(recordingStream, { mimeType })
      : new MediaRecorder(recordingStream);
  }
}

function resetVideoButton() {
  els.confessionalMode.innerHTML =
    '<span class="video-icon" aria-hidden="true"></span><span>Record video</span>';
  els.confessionalMode.classList.remove("recording");
}

function stopVideo() {
  if (!recorder || recorder.state !== "recording") return;
  clearTimeout(videoStopTimer);
  resetVideoButton();
  recorder.stop();
  setBusy(true);
  setStatus("Saving video.");
}

function pickVideoMimeType() {
  const types = [
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function videoExtension(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

async function shareCapture() {
  if (!currentCapture) return;

  const file = new File([currentCapture.blob], currentCapture.fileName, {
    type: currentCapture.blob.type,
  });

  if (
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: "BRIXPIX",
        text: "BRICK 2026",
      });
      setStatus("Shared.");
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus("Share canceled.");
        return;
      }
    }
  }

  const link = document.createElement("a");
  link.href = currentCapture.url;
  link.download = currentCapture.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setStatus("Download started.");
}

function setFilter(filterName, button) {
  selectedFilter = filterName;
  els.booth.dataset.filter = selectedFilter;
  setSelected("[data-filter-choice]", button);
}

function setRingLight(enabled) {
  els.booth.dataset.ring = enabled ? "on" : "off";
  els.ringLightButton.setAttribute("aria-pressed", String(enabled));
}

function toggleRingLight() {
  setRingLight(els.booth.dataset.ring !== "on");
}

function refreshApp() {
  location.reload();
}

function rotateCamera(degrees) {
  if (busy || currentCapture) return;
  cameraRotation = normalizeDegrees(cameraRotation + degrees);
  updateCameraLayout();
}

function addSticker(kind) {
  if (busy || currentCapture) return;
  const countOffset = stickers.length % 4;
  const imageSticker = isImageSticker(kind);
  const sticker = {
    id: nextStickerId,
    kind,
    text: stickerText(kind),
    fill: stickerFill(kind),
    x: 0.5 + countOffset * 0.04,
    y: 0.46 + countOffset * 0.04,
    scale: imageSticker ? 0.9 : 0.72,
    rotation: countOffset % 2 ? 4 : -4,
  };
  nextStickerId += 1;
  stickers.push(sticker);
  selectedStickerId = sticker.id;
  renderStickers();
  closeStickerPicker(false);
  setStatus("Drag to move. Pinch or use the handle to resize and rotate.");
}

function openStickerPicker() {
  closeConfessionalPicker(false);
  openDialog(els.stickerPicker);
  els.openStickerPicker.setAttribute("aria-expanded", "true");
  els.closeStickerPicker.focus();
}

function closeStickerPicker(returnFocus = true) {
  if (els.stickerPicker.classList.contains("hidden")) return;
  closeDialog(els.stickerPicker);
  els.openStickerPicker.setAttribute("aria-expanded", "false");
  if (returnFocus) els.openStickerPicker.focus();
}

function openConfessionalPicker() {
  if (!stream || busy) return;
  closeStickerPicker(false);
  openDialog(els.confessionalPicker);
  els.closeConfessionalPicker.focus();
}

function closeConfessionalPicker(returnFocus = true) {
  if (els.confessionalPicker.classList.contains("hidden")) return;
  closeDialog(els.confessionalPicker);
  if (returnFocus) els.confessionalMode.focus();
}

async function handlePhotoBooth() {
  if (!stream) {
    await startCamera();
    return;
  }
  takePhoto();
}

async function handleConfessionalMode() {
  if (recorder && recorder.state === "recording") {
    stopVideo();
    return;
  }
  if (!stream) {
    await startCamera();
    if (stream) openConfessionalPicker();
    return;
  }
  openConfessionalPicker();
}

function renderStickers() {
  els.stickersLayer.replaceChildren();
  stickers.forEach((sticker) => {
    const node = document.createElement("div");
    node.className = `editable-sticker${emojiSticker(sticker.kind) ? " diamond" : ""}${isImageSticker(sticker.kind) ? " image-sticker" : ""}${sticker.id === selectedStickerId ? " selected" : ""}`;
    node.dataset.stickerId = String(sticker.id);
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute(
      "aria-label",
      `${sticker.text || sticker.kind} sticker. Arrow keys move; Delete removes.`,
    );
    node.setAttribute("aria-pressed", String(sticker.id === selectedStickerId));
    node.addEventListener("focus", () => selectSticker(sticker.id));
    node.addEventListener("keydown", (event) => {
      if (busy || currentCapture) return;
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : 0.01;
        sticker.x = clamp(
          sticker.x +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
          0.05,
          0.95,
        );
        sticker.y = clamp(
          sticker.y +
            (event.key === "ArrowDown"
              ? step
              : event.key === "ArrowUp"
                ? -step
                : 0),
          0.05,
          0.95,
        );
        updateStickerNode(sticker);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelectedSticker();
      }
    });
    if (isImageSticker(sticker.kind)) {
      const image = document.createElement("img");
      image.src = IMAGE_STICKERS[sticker.kind].src;
      image.alt = "";
      image.draggable = false;
      node.append(image);
      node.style.setProperty(
        "--sticker-aspect",
        String(IMAGE_STICKERS[sticker.kind].aspect),
      );
      node.style.setProperty(
        "--sticker-width",
        `${IMAGE_STICKERS[sticker.kind].width}px`,
      );
    } else {
      node.textContent = sticker.text;
      node.style.background = sticker.fill;
    }
    node.style.setProperty("--sticker-x", `${sticker.x * 100}%`);
    node.style.setProperty("--sticker-y", `${sticker.y * 100}%`);
    node.style.setProperty("--sticker-scale", String(sticker.scale));
    node.style.setProperty("--sticker-rotation", `${sticker.rotation}deg`);
    node.addEventListener("pointerdown", startStickerGesture);
    els.stickersLayer.append(node);
  });
  updateStickerTools();
}

function selectedSticker() {
  return stickers.find((sticker) => sticker.id === selectedStickerId);
}

function rotateSelectedSticker() {
  if (busy || currentCapture) return;
  const sticker = selectedSticker();
  if (!sticker) return;
  sticker.rotation = normalizeDegrees(sticker.rotation + 15);
  updateStickerNode(sticker);
}

function removeSelectedSticker() {
  if (!selectedStickerId || busy || currentCapture) return;
  stickers = stickers.filter((sticker) => sticker.id !== selectedStickerId);
  selectedStickerId = stickers.length ? stickers[stickers.length - 1].id : null;
  renderStickers();
}

function startStickerGesture(event) {
  const node = event.currentTarget;
  const sticker = stickers.find(
    (item) => item.id === Number(node.dataset.stickerId),
  );
  if (!sticker || busy || currentCapture) return;
  if (activePointers.size && sticker.id !== selectedStickerId) return;
  event.preventDefault();
  selectSticker(sticker.id);
  els.stickersLayer.querySelectorAll(".editable-sticker").forEach((item) => {
    item.classList.toggle("selected", item === node);
  });
  node.setPointerCapture(event.pointerId);
  node.classList.add("dragging");
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  gesture = makeGesture(sticker);
}

function moveStickerGesture(event) {
  if (!activePointers.has(event.pointerId) || !gesture) return;
  event.preventDefault();
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  const sticker = selectedSticker();
  if (!sticker) return;
  const stageRect = els.liveOverlays.getBoundingClientRect();

  if (activePointers.size >= 2 && gesture.mode === "pinch") {
    const points = [...activePointers.values()];
    const currentDistance = distance(points[0], points[1]);
    const currentAngle = angle(points[0], points[1]);
    const currentCenter = midpoint(points[0], points[1]);
    const ratio = currentDistance / Math.max(1, gesture.distance);

    sticker.scale = clamp(gesture.scale * ratio, 0.22, 3.2);
    sticker.rotation = normalizeDegrees(
      gesture.rotation + currentAngle - gesture.angle,
    );
    sticker.x = clamp(
      gesture.x + (currentCenter.x - gesture.center.x) / stageRect.width,
      0.04,
      0.96,
    );
    sticker.y = clamp(
      gesture.y + (currentCenter.y - gesture.center.y) / stageRect.height,
      0.04,
      0.96,
    );
  } else {
    sticker.x = clamp(
      gesture.x + (event.clientX - gesture.pointer.x) / stageRect.width,
      0.04,
      0.96,
    );
    sticker.y = clamp(
      gesture.y + (event.clientY - gesture.pointer.y) / stageRect.height,
      0.04,
      0.96,
    );
  }

  updateStickerNode(sticker);
}

function endStickerGesture(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);

  if (activePointers.size === 0) {
    gesture = null;
    els.stickersLayer
      .querySelectorAll(".editable-sticker")
      .forEach((node) => node.classList.remove("dragging"));
    return;
  }

  const sticker = selectedSticker();
  if (sticker) gesture = makeGesture(sticker);
}

function makeGesture(sticker) {
  const points = [...activePointers.values()];
  if (points.length >= 2) {
    return {
      mode: "pinch",
      distance: distance(points[0], points[1]),
      angle: angle(points[0], points[1]),
      center: midpoint(points[0], points[1]),
      x: sticker.x,
      y: sticker.y,
      scale: sticker.scale,
      rotation: sticker.rotation,
    };
  }
  return {
    mode: "drag",
    pointer: points[0],
    x: sticker.x,
    y: sticker.y,
  };
}

function updateStickerNode(sticker) {
  const node = els.stickersLayer.querySelector(
    `[data-sticker-id="${sticker.id}"]`,
  );
  if (!node) return;
  node.style.setProperty("--sticker-x", `${sticker.x * 100}%`);
  node.style.setProperty("--sticker-y", `${sticker.y * 100}%`);
  node.style.setProperty("--sticker-scale", String(sticker.scale));
  node.style.setProperty("--sticker-rotation", `${sticker.rotation}deg`);
  updateStickerTools();
}

function applyCanvasFilter(ctx, width, height, filterName) {
  if (filterName === "none") return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (filterName === "mono") {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = contrast(gray, 1.22);
      g = contrast(gray, 1.22);
      b = contrast(gray, 1.22);
    } else if (filterName === "warm") {
      r = contrast(r * 1.1 + 12, 1.08);
      g = contrast(g * 1.03 + 4, 1.06);
      b = contrast(b * 0.86, 1.04);
    } else if (filterName === "flash") {
      r = contrast(r * 1.18 + 10, 1.22);
      g = contrast(g * 1.16 + 10, 1.22);
      b = contrast(b * 1.14 + 10, 1.22);
    } else if (filterName === "acid") {
      r = contrast(g * 1.55, 1.28);
      g = contrast(b * 1.35, 1.28);
      b = contrast(data[i] * 1.2 + 28, 1.28);
    } else if (filterName === "disco") {
      r = contrast(b * 1.45 + 12, 1.2);
      g = contrast(data[i] * 0.85, 1.2);
      b = contrast(data[i + 1] * 1.55 + 18, 1.2);
    } else if (filterName === "dream") {
      r = contrast(r * 1.12 + 16, 1.04);
      g = contrast(g * 1.02 + 8, 1.02);
      b = contrast(b * 1.2 + 18, 1.03);
    } else if (filterName === "vhs") {
      r = contrast(r * 1.28, 1.36);
      g = contrast(g * 1.12, 1.3);
      b = contrast(b * 1.45 + 10, 1.36);
    }

    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }
  ctx.putImageData(imageData, 0, 0);
}

function filterForCanvas(filterName) {
  if (filterName === "warm") return "sepia(0.3) saturate(1.15) contrast(1.08)";
  if (filterName === "flash")
    return "brightness(1.16) contrast(1.22) saturate(1.1)";
  if (filterName === "mono") return "grayscale(1) contrast(1.22)";
  if (filterName === "acid")
    return "hue-rotate(95deg) saturate(2.2) contrast(1.28)";
  if (filterName === "disco")
    return "hue-rotate(250deg) saturate(2.3) contrast(1.2) brightness(1.06)";
  if (filterName === "dream")
    return "sepia(0.2) saturate(1.55) hue-rotate(318deg) brightness(1.1)";
  if (filterName === "vhs")
    return "contrast(1.36) saturate(1.65) hue-rotate(180deg)";
  return "none";
}

function drawPhotoOverlays(ctx, width, height) {
  const rect = els.liveOverlays.getBoundingClientRect();
  const scale = width / Math.max(1, rect.width);
  if (els.logoOverlay.checked) drawLogo(ctx, width, scale);
  stickers.forEach((sticker) =>
    drawSticker(ctx, sticker, sticker.x * width, sticker.y * height, scale),
  );
}

function drawConfessionalPrompt(ctx, width, height, prompt) {
  const scale = Math.max(0.75, Math.min(width / 1280, height / 720));
  const margin = 20 * scale;
  const boxHeight = 68 * scale;
  const x = margin;
  const y = height - boxHeight - margin;
  const boxWidth = width - margin * 2;
  ctx.save();
  ctx.fillStyle = "rgba(248, 243, 232, 0.94)";
  ctx.strokeStyle = "#171310";
  ctx.lineWidth = 2 * scale;
  rectPath(ctx, x, y, boxWidth, boxHeight);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#b91f55";
  ctx.font = `700 ${10 * scale}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("BRICK 2026 · VIDEO", x + 14 * scale, y + 20 * scale);
  ctx.fillStyle = "#171310";
  ctx.font = `italic ${24 * scale}px Georgia, Times New Roman, serif`;
  ctx.fillText(prompt, x + 14 * scale, y + 48 * scale, boxWidth - 28 * scale);
  ctx.restore();
}

function drawLogo(ctx, width, scale) {
  const logo = document.querySelector(".booth-logo");
  const style = getComputedStyle(logo);
  ctx.save();
  ctx.font = `italic ${parseFloat(style.fontSize) * scale}px Georgia, serif`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.shadowColor = "#0007";
  ctx.shadowBlur = 6 * scale;
  ctx.shadowOffsetY = 2 * scale;
  ctx.fillText(
    "brick2026",
    width - parseFloat(style.right) * scale,
    parseFloat(style.top) * scale,
  );
  ctx.restore();
}

function drawSticker(ctx, sticker, centerX, centerY, baseScale) {
  const scale = baseScale * sticker.scale;
  if (isImageSticker(sticker.kind)) {
    drawImageSticker(ctx, sticker, centerX, centerY, scale);
    return;
  }
  const isEmoji = emojiSticker(sticker.kind);
  const paddingX = (isEmoji ? 12 : 15) * scale;
  ctx.save();
  ctx.font = `700 ${isEmoji ? 74 * scale : 34 * scale}px Arial, Helvetica, sans-serif`;
  const metrics = ctx.measureText(sticker.text);
  const width = metrics.width + paddingX * 2 + 6 * scale;
  const height = (isEmoji ? 100 : 60) * scale;
  ctx.translate(centerX, centerY);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.fillStyle = sticker.fill;
  ctx.strokeStyle = "#171310";
  ctx.lineWidth = 3 * scale;
  if (!isEmoji) {
    rectPath(ctx, -width / 2, -height / 2, width, height);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#171310";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(sticker.text, 0, 0);
  ctx.restore();
}

function drawImageSticker(ctx, sticker, centerX, centerY, scale) {
  const image = stickerImages.get(sticker.kind);
  if (!image || !image.complete || !image.naturalWidth) return;
  const config = IMAGE_STICKERS[sticker.kind];
  const width = config.width * scale;
  const height = width / config.aspect;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function rectPath(ctx, x, y, width, height) {
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.closePath();
}

function mediaDisplayRect(stageWidth, stageHeight, mediaWidth, mediaHeight) {
  const stageRatio = stageWidth / stageHeight;
  const mediaRatio = mediaWidth / mediaHeight;
  if (mediaRatio > stageRatio) {
    const height = stageWidth / mediaRatio;
    return { x: 0, y: (stageHeight - height) / 2, width: stageWidth, height };
  }
  const width = stageHeight * mediaRatio;
  return { x: (stageWidth - width) / 2, y: 0, width, height: stageHeight };
}

function stickerText(kind) {
  if (kind === "norbit") return "NORBITLUVR";
  if (kind === "brickdup") return "BRICKDUP";
  if (kind === "congrats") return "CONGRATS";
  if (kind === "diamond") return "💎";
  return "";
}

function isImageSticker(kind) {
  return Boolean(IMAGE_STICKERS[kind]);
}

function stickerFill(kind) {
  if (kind === "brickdup") return "#d8ecf0";
  if (kind === "congrats") return "#f2b6a7";
  if (kind === "diamond") return "transparent";
  return "#f1c64b";
}

function emojiSticker(kind) {
  return kind === "diamond";
}

function setSelected(selector, selectedButton) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle("selected", button === selectedButton);
    button.setAttribute("aria-pressed", String(button === selectedButton));
  });
}

function openArchiveDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function archiveCapture(blob, fileName = timestampFileName("jpg")) {
  try {
    const db = await openArchiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).add({
        blob,
        createdAt: new Date().toISOString(),
        fileName,
        uploadedAt: null,
        uploadAttempts: 0,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    updateArchiveCount();
    syncArchiveUploads();
    return true;
  } catch (error) {
    archiveWarning = true;
    setStatus("Capture ready. Local save failed — share or download now.");
    return false;
  }
}

function getUploadEndpoint() {
  return DEFAULT_UPLOAD_ENDPOINT;
}

async function uploadCapture(record, endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const dataUrl = await blobToDataUrl(record.blob);
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "text/plain",
      },
      body: JSON.stringify({
        fileName: record.fileName || timestampFileName("jpg"),
        mimeType: record.blob.type || "image/jpeg",
        dataUrl,
      }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.ok === true;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function updateArchivedPhoto(id, updates) {
  const db = await openArchiveDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      const photo = request.result;
      if (!photo) {
        resolve();
        return;
      }
      store.put({ ...photo, ...updates });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function scheduleUploadRetry() {
  clearTimeout(uploadRetryTimer);
  uploadRetryTimer = setTimeout(() => {
    syncArchiveUploads();
  }, UPLOAD_RETRY_MS);
}

function prepareUploadQueue() {
  if (uploadPreparationPromise) return uploadPreparationPromise;
  uploadPreparationPromise = (async () => {
    if (uploadQueuePrepared) return;
    try {
      if (localStorage.getItem(UPLOAD_VERIFICATION_KEY) === "1") {
        uploadQueuePrepared = true;
        return;
      }
    } catch (_) {}
    const db = await openArchiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const cursor = tx.objectStore(STORE_NAME).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (item.value.uploadedAt)
          item.update({ ...item.value, uploadedAt: null });
        item.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    uploadQueuePrepared = true;
    try {
      localStorage.setItem(UPLOAD_VERIFICATION_KEY, "1");
    } catch (_) {}
  })().catch((error) => {
    uploadPreparationPromise = null;
    throw error;
  });
  return uploadPreparationPromise;
}

async function nextArchiveCapture(afterId = 0, pendingOnly = true) {
  const db = await openArchiveDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE_NAME)
      .objectStore(STORE_NAME)
      .openCursor(IDBKeyRange.lowerBound(afterId, true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      if (!pendingOnly || !cursor.value.uploadedAt) {
        resolve(cursor.value);
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function syncArchiveUploads() {
  const endpoint = getUploadEndpoint();
  if (!endpoint || !navigator.onLine) {
    if (endpoint && !navigator.onLine) scheduleUploadRetry();
    return;
  }

  try {
    await prepareUploadQueue();
  } catch (error) {
    scheduleUploadRetry();
    return;
  }

  if (uploadSyncInFlight) {
    uploadSyncRequested = true;
    return;
  }
  uploadSyncInFlight = true;

  try {
    let uploadedCount = 0;
    let uploadFailed = false;

    let afterId = 0;
    for (
      let capture = await nextArchiveCapture(afterId);
      capture;
      capture = await nextArchiveCapture(afterId)
    ) {
      afterId = capture.id;
      const ok = await uploadCapture(capture, endpoint);
      if (ok) {
        uploadedCount += 1;
        await updateArchivedPhoto(capture.id, {
          uploadedAt: new Date().toISOString(),
          uploadAttempts: (capture.uploadAttempts || 0) + 1,
        });
      } else {
        uploadFailed = true;
        await updateArchivedPhoto(capture.id, {
          uploadAttempts: (capture.uploadAttempts || 0) + 1,
        });
        break; // A failed endpoint should not receive the entire queue again.
      }
    }

    if (uploadFailed) {
      scheduleUploadRetry();
      if (!busy && currentCapture && !archiveWarning)
        setStatus("Saved on this device. Drive upload will retry.");
    } else if (uploadedCount && currentCapture && !busy && !archiveWarning) {
      setStatus("Saved locally and to Drive.");
    }
    updateArchiveCount();
  } catch (error) {
    scheduleUploadRetry();
  } finally {
    uploadSyncInFlight = false;
    if (uploadSyncRequested) {
      uploadSyncRequested = false;
      syncArchiveUploads();
    }
  }
}

async function updateArchiveCount() {
  if (!isAdmin) return;
  try {
    const db = await openArchiveDb();
    const count = await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME)
        .objectStore(STORE_NAME)
        .count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    els.archiveCount.textContent = `${count} saved`;
  } catch (error) {
    els.archiveCount.textContent = "archive unavailable";
  }
}

async function exportArchive() {
  if (busy) return;
  setBusy(true);
  try {
    let capture = await nextArchiveCapture(0, false);
    if (!capture) {
      setStatus("No saved captures yet.");
      return;
    }
    // Read one blob at a time, including videos, rather than loading the archive.
    while (capture) {
      const url = URL.createObjectURL(capture.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        capture.fileName ||
        `brixpix-${capture.id}.${capture.blob.type.startsWith("video/") ? videoExtension(capture.blob.type) : "jpg"}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await new Promise((resolve) => setTimeout(resolve, 220));
      capture = await nextArchiveCapture(capture.id, false);
    }
    setStatus(
      "Archive downloads started. Allow multiple downloads if prompted.",
    );
  } catch (_) {
    setStatus("Archive could not be read. Try again on the original device.");
  } finally {
    setBusy(false);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function contrast(value, amount) {
  return (value - 128) * amount + 128;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function normalizeDegrees(value) {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
}

function selectSticker(id) {
  selectedStickerId = id;
  els.stickersLayer.querySelectorAll(".editable-sticker").forEach((node) => {
    const selected = Number(node.dataset.stickerId) === id;
    node.classList.toggle("selected", selected);
    node.setAttribute("aria-pressed", String(selected));
  });
  updateStickerTools();
}

function updateStickerTools() {
  const sticker = selectedSticker();
  const node =
    sticker &&
    els.stickersLayer.querySelector(`[data-sticker-id="${sticker.id}"]`);
  const visible = node && !busy && !currentCapture;
  els.stickerTools.classList.toggle("hidden", !visible);
  if (!visible) return;
  const stage = els.stage.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const width = 140;
  els.stickerTools.style.left = `${clamp(rect.left + rect.width / 2 - stage.left - width / 2, 8, stage.width - width - 8)}px`;
  const above = rect.top - stage.top - 52;
  els.stickerTools.style.top = `${clamp(above >= 8 ? above : rect.bottom - stage.top + 8, 8, stage.height - 52)}px`;
}

function startHandleGesture(event) {
  const sticker = selectedSticker();
  if (!sticker || busy || currentCapture) return;
  event.preventDefault();
  const frame = els.liveOverlays.getBoundingClientRect();
  const center = {
    x: frame.left + sticker.x * frame.width,
    y: frame.top + sticker.y * frame.height,
  };
  const pointer = { x: event.clientX, y: event.clientY };
  handleGesture = {
    id: event.pointerId,
    center,
    distance: distance(center, pointer),
    angle: angle(center, pointer),
    scale: sticker.scale,
    rotation: sticker.rotation,
  };
  els.resizeSticker.setPointerCapture(event.pointerId);
}

function moveHandleGesture(event) {
  if (!handleGesture || event.pointerId !== handleGesture.id) return;
  const sticker = selectedSticker();
  if (!sticker) return;
  event.preventDefault();
  const pointer = { x: event.clientX, y: event.clientY };
  sticker.scale = clamp(
    (handleGesture.scale * distance(handleGesture.center, pointer)) /
      Math.max(1, handleGesture.distance),
    0.22,
    3.2,
  );
  sticker.rotation = normalizeDegrees(
    handleGesture.rotation +
      angle(handleGesture.center, pointer) -
      handleGesture.angle,
  );
  updateStickerNode(sticker);
}

function openDialog(dialog) {
  selectSticker(null);
  dialog.classList.remove("hidden");
  [...els.booth.children].forEach((child) => {
    if (child !== dialog && !child.classList.contains("picker"))
      child.inert = true;
  });
}

function closeDialog(dialog) {
  dialog.classList.add("hidden");
  [...els.booth.children].forEach((child) => {
    child.inert = false;
  });
}

function returnToCamera() {
  clearCapture();
  setStatus("Ready.");
}

function resetGuest() {
  if (busy) return;
  clearCapture();
  stickers = [];
  selectedStickerId = null;
  activePointers.clear();
  gesture = null;
  handleGesture = null;
  renderStickers();
  setFilter("none", document.querySelector('[data-filter-choice="none"]'));
  els.timer.value = "3";
  els.logoOverlay.checked = true;
  els.booth.dataset.logo = "on";
  setStatus("Ready.");
}

els.retakeCapture.addEventListener("click", returnToCamera);
els.nextGuest.addEventListener("click", resetGuest);
els.resizeSticker.addEventListener("pointerdown", startHandleGesture);
els.resizeSticker.addEventListener("pointermove", moveHandleGesture);
["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
  els.resizeSticker.addEventListener(type, () => {
    handleGesture = null;
  }),
);
els.resizeSticker.addEventListener("keydown", (event) => {
  const sticker = selectedSticker();
  if (!sticker || !event.key.startsWith("Arrow")) return;
  event.preventDefault();
  sticker.scale = clamp(
    sticker.scale +
      (event.key === "ArrowUp" || event.key === "ArrowRight" ? 0.1 : -0.1),
    0.22,
    3.2,
  );
  updateStickerNode(sticker);
});
els.stage.addEventListener("pointerdown", (event) => {
  if (event.target === els.camera || event.target === els.stage)
    selectSticker(null);
});
document.addEventListener("keydown", (event) => {
  const dialog = document.querySelector(".picker:not(.hidden)");
  if (!dialog || event.key !== "Tab") return;
  const buttons = [...dialog.querySelectorAll("button:not(:disabled)")];
  const first = buttons[0],
    last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

els.startCamera.addEventListener("click", startCamera);
els.refreshApp.addEventListener("click", refreshApp);
els.rotateCameraLeft.addEventListener("click", () => rotateCamera(-90));
els.rotateCameraRight.addEventListener("click", () => rotateCamera(90));
els.stage.addEventListener("click", (event) => {
  if (!stream && event.target === els.camera) startCamera();
});
els.photoBooth.addEventListener("click", handlePhotoBooth);
els.confessionalMode.addEventListener("click", handleConfessionalMode);
els.shareCapture.addEventListener("click", shareCapture);
els.ringLightButton.addEventListener("click", toggleRingLight);
els.openStickerPicker.addEventListener("click", openStickerPicker);
els.closeStickerPicker.addEventListener("click", () => closeStickerPicker());
els.stickerPicker.addEventListener("click", (event) => {
  if (event.target === els.stickerPicker) closeStickerPicker();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeStickerPicker();
    closeConfessionalPicker();
  }
});
els.closeConfessionalPicker.addEventListener("click", () =>
  closeConfessionalPicker(),
);
els.confessionalPicker.addEventListener("click", (event) => {
  if (event.target === els.confessionalPicker) closeConfessionalPicker();
});
document.querySelectorAll("[data-confessional-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    closeConfessionalPicker(false);
    recordVideo(button.dataset.confessionalPrompt);
  });
});
els.logoOverlay.addEventListener("change", () => {
  els.booth.dataset.logo = els.logoOverlay.checked ? "on" : "off";
});
document.querySelectorAll("[data-filter-choice]").forEach((button) => {
  button.addEventListener("click", () =>
    setFilter(button.dataset.filterChoice, button),
  );
});
document.querySelectorAll("[data-sticker-choice]").forEach((button) => {
  button.addEventListener("click", () =>
    addSticker(button.dataset.stickerChoice),
  );
});
els.rotateSticker.addEventListener("click", rotateSelectedSticker);
els.removeSticker.addEventListener("click", removeSelectedSticker);
window.addEventListener("pointermove", moveStickerGesture);
window.addEventListener("pointerup", endStickerGesture);
window.addEventListener("pointercancel", endStickerGesture);
els.camera.addEventListener("resize", updateCameraLayout);
new ResizeObserver(updateCameraLayout).observe(els.stage);
window.addEventListener("online", syncArchiveUploads);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateCameraLayout);
}
window.addEventListener("pagehide", () => {
  clearCapture();
  if (recorder?.state === "recording") stopVideo();
  stopCameraStream();
  wakeLock?.release();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) startCamera();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") requestWakeLock();
});

if (isAdmin) {
  els.booth.classList.add("is-admin");
  els.adminPanel.classList.remove("hidden");
  els.exportArchive.addEventListener("click", exportArchive);
  updateArchiveCount();
}

setBusy(false);
els.booth.style.setProperty("--camera-rotation", "0deg");
syncArchiveUploads();

startCamera();
