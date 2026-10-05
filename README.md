# BRIXPIX

Tiny static photo booth app for an iPad in a fullscreen browser.

## Free setup

1. Put these files in a GitHub repository.
2. Turn on GitHub Pages for the repository.
3. Open the GitHub Pages URL in Safari on the iPad.
4. Tap Share, then Add to Home Screen. It launches as `BRIXPIX` with the custom camera icon.

Camera access requires HTTPS or localhost. GitHub Pages gives you HTTPS for free.

## Owner archive

Every photo and video is silently saved to local IndexedDB inside this web app on the iPad after capture. This is not the iOS Photos app, so saved captures will not appear in Photos automatically. Guests do not see a gallery, and clearing the guest preview does not remove the owner archive. Videos stop automatically after 15 seconds and use a conservative bitrate to keep free cloud uploads reliable.

To export saved photos, open the app on the same iPad with `?admin=1` at the end of the URL and use Export archive.

GitHub Pages cannot receive automatic background uploads from the app. A browser-based GitHub upload would require exposing a writable GitHub token to guests, which is not safe.

This build includes a baked-in Google Apps Script webhook that saves each captured photo and video to Drive in the background. If Wi-Fi drops or Drive rejects an upload, the app keeps the local copy and retries later. The app verifies Drive's success response before marking a capture uploaded, and no per-iPad webhook setup is required.

## Sharing

On iPad Safari, the Share button uses the native iOS share sheet when available. Guests can AirDrop, save, message, or email from there. If file sharing is unavailable, use Download.

## Ring light

The ring light toggle adds a large soft white screen border. For best results at a wedding booth, use an actual USB/battery ring light too.

Safari web apps cannot set the iPad's system brightness like Apple Wallet can. Apple does not expose that private brightness control to normal websites. Set brightness manually before the event and use Guided Access to keep the app open.

## Overlays

Guests can pick a filter, add multiple stickers, drag them around the camera preview, pinch to resize/rotate, and toggle the `BRIXPIX` mark. Filters, stickers, and the watermark are composited into saved photos and videos. Video playback uses native browser controls for better iOS compatibility.

Mac and iOS camera features such as Center Stage can crop or reframe before the browser receives the video. The app itself uses `object-fit: contain` so it does not add another crop on top.

## Printer notes

The simple iPad path is AirPrint: buy an AirPrint-compatible photo printer, keep it on the same Wi-Fi as the iPad, and use the iOS share sheet from the captured photo.

Receipt-printer output is funny, but it is a separate project. Most thermal receipt printers want USB, Bluetooth serial, a vendor app, or a local computer/server bridge. If you want that vibe, the least fragile version is probably a laptop running the booth plus a USB thermal printer, with a dedicated "print receipt" layout.

## Extra wedding-hit ideas

- A short prompt card next to the iPad: "Give us your worst advice."
- One-tap themed stickers: ceremony, reception, afterparty.
- A prop table with a few visually loud items, not twenty tiny options.
- A second "guestbook mode" later: record a 10-second video toast.
- A QR code nearby that opens a shared Google Photos/Drive upload folder for guests who want to contribute phone photos.
- Print two copies when printing: one for the guest, one for a physical guestbook.

## Development

The app is static HTML, CSS and JavaScript; there is no build step.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
node --check app.js
```

In the prepared cloud environment, run the browser checks with the server running:

```sh
NODE_PATH=/workspace/onboarding-tools/node_modules node tests/booth.cjs
```

For another machine, install `playwright@1.58.2` in an external tools directory and set `NODE_PATH` to its `node_modules`. The test defaults to `/usr/bin/chromium`; set `CHROMIUM_PATH` to your Chromium executable. It uses simulated camera/microphone input and intercepts every external browser request. It never uploads synthetic captures to Drive.

Camera access starts automatically when the browser allows it; denied access reveals a retry button. Photos do not request microphone permission. Video requests microphone permission when selected and can record silently if denied. Use an HTTPS deployment to test on an iPad; a cloud machine's localhost is not reachable from your phone.

The header is removed and the camera occupies the space above compact controls. All guest controls and picker choices fit within the viewport on iPad in portrait and landscape. Filters are unlabeled color tiles with accessible names. Selected stickers have move, resize/rotate and delete controls in the preview. Back to camera retains effects; Next guest resets stickers, filter, timer and watermark while preserving the screen-light setting and owner archive.

See [REVIEW.md](REVIEW.md) for review findings and external integration limits.
