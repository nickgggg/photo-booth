// Run against the local static server. Uses simulated media and intercepts ALL
// external requests: these tests never send guest or synthetic data to Drive.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const baseURL = process.env.BOOTH_TEST_URL || "http://127.0.0.1:8000";
let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed++;
  console.log(`PASS ${name}`);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  try {
    const context = await browser.newContext({
      permissions: ["camera", "microphone"],
      acceptDownloads: true,
    });
    let uploadMode = "offline";
    let uploads = 0;
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === baseURL)
        return route.continue();
      if (route.request().url().startsWith("https://script.google.com/")) {
        uploads++;
        if (uploadMode === "success")
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"ok":true}',
          });
        if (uploadMode === "rejected")
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"ok":false}',
          });
      }
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const open = async () => {
      await page.goto(baseURL);
      await page.waitForFunction(
        () =>
          document.querySelector("#camera").videoWidth > 0 &&
          !document.querySelector("#photoBooth").disabled,
      );
      await page.selectOption("#timer", "0");
    };
    const records = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("brixpix-archive");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return new Promise((resolve, reject) => {
          const req = db.transaction("photos").objectStore("photos").getAll();
          req.onsuccess = () =>
            resolve(
              req.result.map((r) => ({
                id: r.id,
                size: r.blob.size,
                type: r.blob.type,
                uploadedAt: r.uploadedAt,
                attempts: r.uploadAttempts,
              })),
            );
          req.onerror = () => reject(req.error);
        });
      });
    const noClipping = () =>
      page.evaluate(() => {
        const controls = document.querySelector(".controls");
        const visible = [
          ...document.querySelectorAll("button, select, input"),
        ].filter((el) => el.getClientRects().length && !el.closest(".hidden"));
        return (
          document.documentElement.scrollHeight <= innerHeight &&
          controls.scrollHeight <= controls.clientHeight &&
          visible.every((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.x >= 0 &&
              r.y >= 0 &&
              r.right <= innerWidth + 0.5 &&
              r.bottom <= innerHeight + 0.5
            );
          })
        );
      });
    for (const [width, height] of [
      [1024, 768],
      [768, 1024],
      [1180, 820],
      [820, 1180],
      [1366, 1024],
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await open();
      check(`all controls fit ${width}x${height}`, await noClipping());
      await page.click("#openStickerPicker");
      check(
        `all sticker choices fit ${width}x${height}`,
        await page.evaluate(() => {
          const s = document.querySelector(".picker-sheet");
          return s.scrollHeight <= s.clientHeight;
        }),
      );
      await page.keyboard.press("Escape");
      await page.click("#confessionalMode");
      check(
        `all video prompts fit ${width}x${height}`,
        await page.evaluate(() => {
          const s = document.querySelector(".video-sheet");
          return s.scrollHeight <= s.clientHeight;
        }),
      );
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await open();
    check(
      "automatic camera starts without microphone",
      await page.evaluate(
        () =>
          document.querySelector("#camera").srcObject.getAudioTracks()
            .length === 0,
      ),
    );
    check(
      "camera thumbnails are rendered",
      await page.evaluate(() =>
        [...document.querySelectorAll(".filter-swatch")].every(
          (canvas) =>
            canvas.getContext("2d").getImageData(10, 10, 1, 1).data[3] === 255,
        ),
      ),
    );
    check(
      "filter thumbnails show different effects",
      await page.evaluate(() => {
        const a = document
          .querySelector('[data-filter-choice="none"] canvas')
          .toDataURL();
        const b = document
          .querySelector('[data-filter-choice="mono"] canvas')
          .toDataURL();
        return a !== b;
      }),
    );
    await page.click('[data-filter-choice="mono"]');
    check(
      "filter selection has accessible state",
      (await page.getAttribute(
        '[data-filter-choice="mono"]',
        "aria-pressed",
      )) === "true",
    );
    await page.click("#openStickerPicker");
    check(
      "modal isolates background",
      await page.evaluate(() => document.querySelector(".controls").inert),
    );
    await page.keyboard.press("Shift+Tab");
    check(
      "modal traps keyboard focus",
      await page.evaluate(
        () =>
          document.activeElement ===
          document.querySelector('[data-sticker-choice="cat"]'),
      ),
    );
    await page.click('[data-sticker-choice="nickbrenna"]');
    check(
      "custom sticker preserved",
      (await page.locator(".editable-sticker img").getAttribute("src")) ===
        "stickers/nick-brenna.png",
    );
    check(
      "tools attached to selected sticker",
      await page.locator("#stickerTools").isVisible(),
    );
    const sticker = page.locator(".editable-sticker");
    let box = await sticker.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 70,
      box.y + box.height / 2 + 30,
      { steps: 8 },
    );
    await page.mouse.up();
    const moved = await sticker.boundingBox();
    check("drag moves sticker", moved.x > box.x + 50);
    const beforeRotate = await sticker.getAttribute("style");
    await page.click("#rotateSticker");
    check(
      "on-sticker rotate works",
      (await sticker.getAttribute("style")) !== beforeRotate,
    );
    const handle = await page.locator("#resizeSticker").boundingBox();
    box = await sticker.boundingBox();
    await page.mouse.move(handle.x + 22, handle.y + 22);
    await page.mouse.down();
    await page.mouse.move(handle.x + 70, handle.y - 45, { steps: 8 });
    await page.mouse.up();
    check(
      "resize handle changes sticker geometry",
      (await sticker.boundingBox()).width !== box.width,
    );
    await page.click("#removeSticker");
    check("on-sticker delete works", (await sticker.count()) === 0);
    await page.click("#openStickerPicker");
    await page.click('[data-sticker-choice="cat"]');
    // Send trusted touchscreen input; synthetic pointer events cannot own capture.
    const touch = await context.newCDPSession(page);
    box = await sticker.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: x - 15, y, id: 1 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 15, y, id: 1 },
        { x: x + 15, y, id: 2 },
      ],
    });
    const beforePinch = await sticker.getAttribute("style");
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 35, y: y - 15, id: 1 },
        { x: x + 35, y: y + 15, id: 2 },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    check(
      "two-finger pinch resizes and rotates",
      (await sticker.getAttribute("style")) !== beforePinch,
    );
    await page.click("#ringLightButton");
    check(
      "soft light toggles",
      (await page.getAttribute("#ringLightButton", "aria-pressed")) === "true",
    );
    await page.selectOption("#timer", "3");
    await page.click("#photoBooth");
    await page.waitForSelector("#countdown:not(.hidden)");
    check(
      "capture locks settings during countdown",
      (await page.locator("#refreshApp").isDisabled()) &&
        (await page.locator("#timer").isDisabled()),
    );
    await page.waitForSelector("#result img");
    await page.waitForFunction(
      () => document.querySelector("#result img").naturalWidth > 0,
    );
    check(
      "photo archived as nonempty JPEG",
      (await records()).some((r) => r.type === "image/jpeg" && r.size > 1000),
    );
    check(
      "light remains on between captures",
      (await page.getAttribute("#ringLightButton", "aria-pressed")) === "true",
    );
    check("review controls fit landscape", await noClipping());
    const captureURL = await page.locator("#result img").getAttribute("src");
    const cameraTrack = await page.evaluate(
      () => document.querySelector("#camera").srcObject.getVideoTracks()[0].id,
    );
    await page.setViewportSize({ width: 768, height: 1024 });
    check(
      "resize preserves capture and camera stream",
      (await page.locator("#result img").getAttribute("src")) === captureURL &&
        (await page.evaluate(
          () =>
            document.querySelector("#camera").srcObject.getVideoTracks()[0].id,
        )) === cameraTrack,
    );
    check("review controls fit portrait", await noClipping());
    const download = page.waitForEvent("download");
    await page.click("#shareCapture");
    check(
      "sharing falls back to a JPEG download",
      (await download).suggestedFilename().endsWith(".jpg"),
    );
    await page.click("#retakeCapture");
    check(
      "back to camera retains stickers",
      (await sticker.count()) === 1 &&
        !(await page.locator("#result").isVisible()),
    );
    await page.click("#rotateCameraRight");
    await page.selectOption("#timer", "0");
    await page.click("#photoBooth");
    await page.waitForSelector("#result img");
    await page.waitForFunction(
      () => document.querySelector("#result img").naturalWidth > 0,
    );
    check(
      "saved photo honors 90-degree rotation",
      await page.evaluate(() => {
        const img = document.querySelector("#result img"),
          video = document.querySelector("#camera");
        return (
          img.naturalWidth === video.videoHeight &&
          img.naturalHeight === video.videoWidth
        );
      }),
    );
    await page.click("#nextGuest");
    check(
      "next guest resets effects and stickers",
      (await sticker.count()) === 0 &&
        (await page.inputValue("#timer")) === "3" &&
        (await page.getAttribute(
          '[data-filter-choice="none"]',
          "aria-pressed",
        )) === "true",
    );
    await page.selectOption("#timer", "0");
    await page.click("#confessionalMode");
    await page.click('[data-confessional-prompt="Freestyle"]');
    await page.waitForSelector("#recordingIndicator:not(.hidden)");
    check(
      "recording shows time and stop action",
      (await page.locator("#confessionalMode").textContent()).includes("Stop"),
    );
    await page.waitForFunction(() =>
      document.querySelector("#recordingTime").textContent.startsWith("00:01"),
    );
    await page.click("#confessionalMode");
    await page.waitForSelector("#result video");
    check(
      "video capture archived",
      (await records()).some(
        (r) => r.type.startsWith("video/") && r.size > 1000,
      ),
    );
    check(
      "microphone released after recording",
      await page.evaluate(() => microphoneStream === null),
    );
    await page.click("#retakeCapture");
    await page.click("#confessionalMode");
    await page.click('[data-confessional-prompt="Roast"]');
    await page.waitForSelector("#recordingIndicator:not(.hidden)");
    await page.waitForSelector("#result video", { timeout: 20000 });
    check(
      "video automatically stops at 15 seconds",
      !(await page.locator("#recordingIndicator").isVisible()),
    );
    // Drive acknowledgments are simulated; no real uploads leave the browser.
    uploadMode = "rejected";
    await page.evaluate(() => syncArchiveUploads());
    check(
      "rejected Drive acknowledgment keeps queue pending",
      (await records()).every((r) => !r.uploadedAt),
    );
    uploadMode = "success";
    await page.evaluate(() => syncArchiveUploads());
    check(
      "successful Drive acknowledgment marks queue uploaded",
      (await records()).every((r) => !!r.uploadedAt),
    );
    check("upload path exercised", uploads > 0);
    const archivedCount = (await records()).length;
    await page.goto(baseURL + "/?admin=1");
    await page.waitForFunction(
      (expected) =>
        document.querySelector("#archiveCount").textContent ===
          `${expected} saved` &&
        !document.querySelector("#photoBooth").disabled,
      archivedCount,
    );
    check("owner archive controls fit", await noClipping());
    const exported = [];
    page.on("download", (download) =>
      exported.push(download.suggestedFilename()),
    );
    await page.click("#exportArchive");
    await page.waitForFunction(
      () => !document.querySelector("#exportArchive").disabled,
    );
    check(
      "owner exports every archived capture",
      exported.length === archivedCount,
    );
    check(
      "video export retains file type",
      exported.some((name) => name.endsWith(".mp4") || name.endsWith(".webm")),
    );
    check("no browser runtime errors", errors.length === 0);
    // Inject failures at the browser boundary to verify recovery UI.
    const failureContext = await browser.newContext({
      permissions: ["camera"],
    });
    await failureContext.route("**/*", (r) =>
      new URL(r.request().url()).origin === baseURL ? r.continue() : r.abort(),
    );
    const failure = await failureContext.newPage();
    await failure.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      let first = true;
      navigator.mediaDevices.getUserMedia = (constraints) => {
        if (first) {
          first = false;
          return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        }
        if (constraints.audio && !constraints.video)
          return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        return original(constraints);
      };
    });
    await failure.goto(baseURL);
    await failure.waitForSelector("#startCamera:not(.hidden)");
    check(
      "camera denial exposes recovery action",
      (await failure.locator("#cameraMessage").textContent()).includes(
        "Allow camera",
      ),
    );
    await failure.click("#startCamera");
    await failure.waitForFunction(
      () => !document.querySelector("#photoBooth").disabled,
    );
    check(
      "camera permission retry succeeds",
      !(await failure.locator("#cameraWelcome").isVisible()),
    );
    await failure.selectOption("#timer", "0");
    await failure.click("#confessionalMode");
    await failure.click('[data-confessional-prompt="Freestyle"]');
    await failure.waitForSelector("#recordingIndicator:not(.hidden)");
    check(
      "microphone denial allows silent recording",
      (await failure.locator("#status").textContent()).includes(
        "without sound",
      ),
    );
    await failure.waitForFunction(() =>
      document.querySelector("#recordingTime").textContent.startsWith("00:01"),
    );
    await failure.click("#confessionalMode");
    await failure.waitForSelector("#result video");
    await failure.click("#retakeCapture");
    await failure.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === "readwrite")
          throw new DOMException("Quota", "QuotaExceededError");
        return original.apply(this, args);
      };
    });
    await failure.click("#photoBooth");
    await failure.waitForSelector("#result img");
    check(
      "local archive failure remains visible",
      (await failure.locator("#status").textContent()).includes(
        "Local save failed",
      ),
    );
    check(
      "capture still shareable after archive failure",
      !(await failure.locator("#shareCapture").isDisabled()),
    );
    await failureContext.close();
    await context.close();
    console.log(`${passed} checks passed.`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
