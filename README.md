# Wedding Photo Booth

Tiny static photo booth app for an iPad in a fullscreen browser.

## Free setup

1. Put these files in a GitHub repository.
2. Turn on GitHub Pages for the repository.
3. Open the GitHub Pages URL in Safari on the iPad.
4. Tap Share, then Add to Home Screen for a kiosk-like fullscreen launch.

Camera access requires HTTPS or localhost. GitHub Pages gives you HTTPS for free.

## Privacy

The app does not keep a gallery, does not upload captures, and does not use browser storage. Each capture lives only in the current browser session until the guest shares, downloads, deletes, refreshes, or leaves the page.

## Sharing

On iPad Safari, the Share button uses the native iOS share sheet when available. Guests can AirDrop, save, message, or email from there. If file sharing is unavailable, use Download.

## Ring light

The ring light toggle adds a large soft white screen border. For best results at a wedding booth, use an actual USB/battery ring light too.

## Overlays

Guests can pick a lightweight filter, add a sticker, and toggle the `brick2026` mark. Photo overlays are burned into downloaded/shared photos. Video overlays appear in the booth preview/playback UI; keeping them burned into videos would require a more complex canvas-recording path and more device testing on iPad Safari.

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
