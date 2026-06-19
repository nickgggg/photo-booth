"use strict";

const els = {
  booth: document.querySelector(".booth"),
  stage: document.getElementById("stage"),
  camera: document.getElementById("camera"),
  snapshot: document.getElementById("snapshot"),
  stickersLayer: document.getElementById("stickersLayer"),
  result: document.getElementById("result"),
  countdown: document.getElementById("countdown"),
  tapToStart: document.getElementById("tapToStart"),
  startCamera: document.getElementById("startCamera"),
  refreshApp: document.getElementById("refreshApp"),
  timer: document.getElementById("timer"),
  ringLightButton: document.getElementById("ringLightButton"),
  logoOverlay: document.getElementById("logoOverlay"),
  rotateSticker: document.getElementById("rotateSticker"),
  removeSticker: document.getElementById("removeSticker"),
  takePhoto: document.getElementById("takePhoto"),
  recordVideo: document.getElementById("recordVideo"),
  shareCapture: document.getElementById("shareCapture"),
  clearCapture: document.getElementById("clearCapture"),
  adminPanel: document.getElementById("adminPanel"),
  exportArchive: document.getElementById("exportArchive"),
  archiveCount: document.getElementById("archiveCount"),
  status: document.getElementById("status")
};

const DB_NAME = "brixpix-archive";
const DB_VERSION = 1;
const STORE_NAME = "photos";
const isAdmin = new URLSearchParams(location.search).has("admin");

let stream = null;
let recorder = null;
let chunks = [];
let currentCapture = null;
let busy = false;
let selectedFilter = "none";
let stickers = [];
let selectedStickerId = null;
let nextStickerId = 1;
let dbPromise = null;
const activePointers = new Map();
let gesture = null;

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
  els.clearCapture.disabled = busy || !hasCapture;
  els.startCamera.disabled = busy;
}

function clearCapture() {
  if (currentCapture) URL.revokeObjectURL(currentCapture.url);
  currentCapture = null;
  els.result.replaceChildren();
  els.result.classList.add("hidden");
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
    els.tapToStart.classList.add("hidden");
    els.startCamera.textContent = "Restart";
    setStatus(window.MediaRecorder ? "Ready." : "Ready for photos. Video is not supported here.");
  } catch (error) {
    setStatus("Camera blocked. Use HTTPS and allow camera access.");
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
  const fileName = `brixpix-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  const url = URL.createObjectURL(blob);
  currentCapture = { blob, fileName, type, url };

  const media = type === "photo" ? document.createElement("img") : document.createElement("video");
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
  setStatus(type === "photo" ? "Saved. Share with AirDrop." : "Video ready.");
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

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const captureFilter = filterForCanvas(selectedFilter);
  ctx.save();
  ctx.filter = captureFilter;
  const canvasFilterApplied = ctx.filter === captureFilter;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (captureFilter !== "none" && !canvasFilterApplied) {
    // If a browser ignored canvas filters, the fallback keeps saved photos from being unfiltered.
    applyCanvasFilter(ctx, canvas.width, canvas.height, selectedFilter);
  }
  drawPhotoOverlays(ctx, canvas.width, canvas.height);
  setRingLight(false);

  canvas.toBlob(async (blob) => {
    if (!blob) {
      setStatus("Photo failed. Try again.");
      setBusy(false);
      return;
    }
    await archivePhoto(blob);
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
  els.recordVideo.textContent = "Stop";
  els.recordVideo.classList.add("recording");
  els.recordVideo.disabled = false;
  setStatus("Recording. Tap Stop when done.");
}

function stopVideo() {
  if (!recorder) return;
  els.recordVideo.textContent = "Video";
  els.recordVideo.classList.remove("recording");
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
        title: "BRIXPIX",
        text: "BRICK 2026"
      });
      setStatus("Shared.");
      return;
    } catch (error) {
      setStatus("Share canceled.");
      return;
    }
  }

  setStatus("Use Download on this device.");
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

function addSticker(kind) {
  const stageRect = els.stage.getBoundingClientRect();
  const countOffset = stickers.length % 4;
  const sticker = {
    id: nextStickerId,
    kind,
    text: stickerText(kind),
    fill: stickerFill(kind),
    x: 0.5 + countOffset * 0.04,
    y: 0.46 + countOffset * 0.04,
    scale: kind === "diamond" ? 0.78 : 0.72,
    rotation: countOffset % 2 ? 4 : -4
  };
  nextStickerId += 1;
  stickers.push(sticker);
  selectedStickerId = sticker.id;
  renderStickers();
  setStatus(stageRect.width ? "Drag sticker. Pinch to resize/rotate." : "Sticker added.");
}

function renderStickers() {
  els.stickersLayer.replaceChildren();
  stickers.forEach((sticker) => {
    const node = document.createElement("div");
    node.className = `editable-sticker${sticker.kind === "diamond" ? " diamond" : ""}${sticker.id === selectedStickerId ? " selected" : ""}`;
    node.dataset.stickerId = String(sticker.id);
    node.textContent = sticker.text;
    node.style.background = sticker.fill;
    node.style.setProperty("--sticker-x", `${sticker.x * 100}%`);
    node.style.setProperty("--sticker-y", `${sticker.y * 100}%`);
    node.style.setProperty("--sticker-scale", String(sticker.scale));
    node.style.setProperty("--sticker-rotation", `${sticker.rotation}deg`);
    node.addEventListener("pointerdown", startStickerGesture);
    els.stickersLayer.append(node);
  });
}

function selectedSticker() {
  return stickers.find((sticker) => sticker.id === selectedStickerId);
}

function rotateSelectedSticker() {
  const sticker = selectedSticker();
  if (!sticker) return;
  sticker.rotation = normalizeDegrees(sticker.rotation + 15);
  renderStickers();
}

function removeSelectedSticker() {
  if (!selectedStickerId) return;
  stickers = stickers.filter((sticker) => sticker.id !== selectedStickerId);
  selectedStickerId = stickers.length ? stickers[stickers.length - 1].id : null;
  renderStickers();
}

function startStickerGesture(event) {
  const node = event.currentTarget;
  const sticker = stickers.find((item) => item.id === Number(node.dataset.stickerId));
  if (!sticker) return;

  event.preventDefault();
  selectedStickerId = sticker.id;
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
  const stageRect = els.stage.getBoundingClientRect();

  if (activePointers.size >= 2 && gesture.mode === "pinch") {
    const points = [...activePointers.values()];
    const currentDistance = distance(points[0], points[1]);
    const currentAngle = angle(points[0], points[1]);
    const currentCenter = midpoint(points[0], points[1]);
    const ratio = currentDistance / Math.max(1, gesture.distance);

    sticker.scale = clamp(gesture.scale * ratio, 0.22, 3.2);
    sticker.rotation = normalizeDegrees(gesture.rotation + currentAngle - gesture.angle);
    sticker.x = clamp(gesture.x + (currentCenter.x - gesture.center.x) / stageRect.width, 0.04, 0.96);
    sticker.y = clamp(gesture.y + (currentCenter.y - gesture.center.y) / stageRect.height, 0.04, 0.96);
  } else {
    sticker.x = clamp(gesture.x + (event.clientX - gesture.pointer.x) / stageRect.width, 0.04, 0.96);
    sticker.y = clamp(gesture.y + (event.clientY - gesture.pointer.y) / stageRect.height, 0.04, 0.96);
  }

  updateStickerNode(sticker);
}

function endStickerGesture(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);

  if (activePointers.size === 0) {
    gesture = null;
    els.stickersLayer.querySelectorAll(".editable-sticker").forEach((node) => node.classList.remove("dragging"));
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
      rotation: sticker.rotation
    };
  }
  return {
    mode: "drag",
    pointer: points[0],
    x: sticker.x,
    y: sticker.y
  };
}

function updateStickerNode(sticker) {
  const node = els.stickersLayer.querySelector(`[data-sticker-id="${sticker.id}"]`);
  if (!node) return;
  node.style.setProperty("--sticker-x", `${sticker.x * 100}%`);
  node.style.setProperty("--sticker-y", `${sticker.y * 100}%`);
  node.style.setProperty("--sticker-scale", String(sticker.scale));
  node.style.setProperty("--sticker-rotation", `${sticker.rotation}deg`);
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
      b = contrast(r * 1.2 + 28, 1.28);
    } else if (filterName === "disco") {
      r = contrast(b * 1.45 + 12, 1.2);
      g = contrast(r * 0.85, 1.2);
      b = contrast(g * 1.55 + 18, 1.2);
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
  if (filterName === "flash") return "brightness(1.16) contrast(1.22) saturate(1.1)";
  if (filterName === "mono") return "grayscale(1) contrast(1.22)";
  if (filterName === "acid") return "hue-rotate(95deg) saturate(2.2) contrast(1.28)";
  if (filterName === "disco") return "hue-rotate(250deg) saturate(2.3) contrast(1.2) brightness(1.06)";
  if (filterName === "dream") return "sepia(0.2) saturate(1.55) hue-rotate(318deg) brightness(1.1)";
  if (filterName === "vhs") return "contrast(1.36) saturate(1.65) hue-rotate(180deg)";
  return "none";
}

function drawPhotoOverlays(ctx, width, height) {
  const scale = Math.max(1, width / 1280);
  if (els.logoOverlay.checked) drawLogo(ctx, width, scale);
  stickers.forEach((sticker) => {
    const point = stickerCanvasPoint(sticker, width, height);
    drawSticker(ctx, sticker, point.x, point.y, scale);
  });
}

function drawLogo(ctx, width, scale) {
  const boxWidth = 160 * scale;
  const boxHeight = 74 * scale;
  const x = width - boxWidth - 28 * scale;
  const y = 34 * scale;
  ctx.save();
  ctx.translate(x + boxWidth / 2, y + boxHeight / 2);
  ctx.rotate(0.03);
  ctx.fillStyle = "#171310";
  ctx.strokeStyle = "#f4efe2";
  ctx.lineWidth = 5 * scale;
  rectPath(ctx, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f4efe2";
  ctx.font = `${28 * scale}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("BRIX", 0, -12 * scale);
  ctx.fillStyle = "#f1c64b";
  ctx.fillText("PIX", 0, 19 * scale);
  ctx.restore();
}

function drawSticker(ctx, sticker, centerX, centerY, baseScale) {
  const scale = baseScale * sticker.scale;
  const isDiamond = sticker.kind === "diamond";
  const paddingX = (isDiamond ? 12 : 16) * scale;
  ctx.save();
  ctx.font = `${isDiamond ? 74 * scale : 34 * scale}px Arial, Helvetica, sans-serif`;
  const metrics = ctx.measureText(sticker.text);
  const width = metrics.width + paddingX * 2;
  const height = (isDiamond ? 94 : 56) * scale;
  ctx.translate(centerX, centerY);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.fillStyle = sticker.fill;
  ctx.strokeStyle = "#171310";
  ctx.lineWidth = 4 * scale;
  rectPath(ctx, -width / 2, -height / 2, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#171310";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(sticker.text, 0, isDiamond ? 0 : 2 * scale);
  ctx.restore();
}

function rectPath(ctx, x, y, width, height) {
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.closePath();
}

function stickerCanvasPoint(sticker, width, height) {
  const stageRect = els.stage.getBoundingClientRect();
  const videoRect = mediaDisplayRect(stageRect.width, stageRect.height, els.camera.videoWidth || width, els.camera.videoHeight || height);
  const stageX = sticker.x * stageRect.width;
  const stageY = sticker.y * stageRect.height;
  const clampedX = clamp(stageX, videoRect.x, videoRect.x + videoRect.width);
  const clampedY = clamp(stageY, videoRect.y, videoRect.y + videoRect.height);
  return {
    x: ((clampedX - videoRect.x) / videoRect.width) * width,
    y: ((clampedY - videoRect.y) / videoRect.height) * height
  };
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

function stickerFill(kind) {
  if (kind === "brickdup") return "#d8ecf0";
  if (kind === "congrats") return "#f2b6a7";
  if (kind === "diamond") return "#d8ecf0";
  return "#f1c64b";
}

function setSelected(selector, selectedButton) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle("selected", button === selectedButton);
  });
}

function openArchiveDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function archivePhoto(blob) {
  try {
    const db = await openArchiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).add({
        blob,
        createdAt: new Date().toISOString(),
        fileName: `brixpix-${Date.now()}.jpg`
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    updateArchiveCount();
  } catch (error) {
    setStatus("Photo ready. Archive save failed on this browser.");
  }
}

async function getArchivedPhotos() {
  const db = await openArchiveDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateArchiveCount() {
  if (!isAdmin) return;
  try {
    const photos = await getArchivedPhotos();
    els.archiveCount.textContent = `${photos.length} saved`;
  } catch (error) {
    els.archiveCount.textContent = "archive unavailable";
  }
}

async function exportArchive() {
  const photos = await getArchivedPhotos();
  if (!photos.length) {
    setStatus("No saved photos yet.");
    return;
  }

  for (const photo of photos) {
    const url = URL.createObjectURL(photo.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = photo.fileName || `brixpix-${photo.id}.jpg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await new Promise((resolve) => setTimeout(resolve, 220));
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
    y: (a.y + b.y) / 2
  };
}

function normalizeDegrees(value) {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
}

els.startCamera.addEventListener("click", startCamera);
els.refreshApp.addEventListener("click", refreshApp);
els.tapToStart.addEventListener("click", startCamera);
els.stage.addEventListener("click", (event) => {
  if (!stream && event.target === els.camera) startCamera();
});
els.takePhoto.addEventListener("click", takePhoto);
els.recordVideo.addEventListener("click", () => {
  if (recorder && recorder.state === "recording") stopVideo();
  else recordVideo();
});
els.clearCapture.addEventListener("click", () => {
  clearCapture();
  setStatus("Ready.");
});
els.shareCapture.addEventListener("click", shareCapture);
els.ringLightButton.addEventListener("click", toggleRingLight);
els.logoOverlay.addEventListener("change", () => {
  els.booth.dataset.logo = els.logoOverlay.checked ? "on" : "off";
});
document.querySelectorAll("[data-filter-choice]").forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filterChoice, button));
});
document.querySelectorAll("[data-sticker-choice]").forEach((button) => {
  button.addEventListener("click", () => addSticker(button.dataset.stickerChoice));
});
els.rotateSticker.addEventListener("click", rotateSelectedSticker);
els.removeSticker.addEventListener("click", removeSelectedSticker);
window.addEventListener("pointermove", moveStickerGesture);
window.addEventListener("pointerup", endStickerGesture);
window.addEventListener("pointercancel", endStickerGesture);
window.addEventListener("pagehide", () => {
  clearCapture();
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

if (isAdmin) {
  els.adminPanel.classList.remove("hidden");
  els.exportArchive.addEventListener("click", exportArchive);
  updateArchiveCount();
}

setBusy(false);
