# Design and code review

The guest workflow is now camera → capture → immediate return to the live camera. The latest file remains available through View and Share; Reset always clears the guest session without reloading or deleting the owner archive. The camera preview spans the full iPad width above a condensed control strip in landscape. Portrait controls use two compact rows. The branding header and decorative side-panel content were removed to reclaim camera space. Controls use action names, without decorative headings, section dividers or hidden scrolling.

## Remediated

- Camera starts automatically, with a visible recovery action on permission/device failure. Microphone denial no longer blocks photography.
- Capture actions are separate from branding. Timer and rotation have clear labels and touch targets; refresh has a visible name.
- Stickers use direct manipulation: drag, pinch, attached delete/rotate controls and a resize/rotate handle. Keyboard movement, resizing and removal are supported. Changing selection preserves pointer capture.
- Rotation applies to preview, saved photos and video. Overlay coordinates and sizes use the displayed camera frame, so letterboxing no longer moves/clamps stickers unexpectedly. The saved watermark matches the live brick2026 mark.
- Resize changes geometry without restarting the camera or deleting the latest capture. Screen wake lock is requested where supported.
- Filters are larger color tiles with accessible names and no visible text. Live thumbnail rendering was removed; video rendering retains its 15 fps and 720 px cap.
- Light fades inward without a solid border, over 89.6 px (1.6 × the old 56 px border). The setting stays on between captures.
- The idle status badge is removed. Actionable storage errors and upload warnings remain visible in the camera area.
- Keyboard-style remotes can trigger photos with Enter/Space; optional Camera/AudioVolumeUp events are handled only when delivered by the browser. Key repeat/debounce and capture locks prevent duplicate shots. Picker and field input retain normal editing.
- Capture/countdown locks conflicting controls. Recording shows elapsed time, supports explicit stop and stops automatically at 15 seconds. Recorder/microphone/compositor resources are released on stop or failure.
- Share uses native file sharing, then a download fallback. Archive errors remain visible instead of being overwritten by a success message.
- Upload/export read one archive blob at a time; counts use IndexedDB count instead of loading all media. Uploads time out, stop a failed batch after its first failed destination call, retry later and require `ok: true` before marking a capture uploaded. Database and queue preparation can recover after a failed attempt.
- Picker dialogs isolate background controls, trap keyboard focus and restore focus on dismissal. Filter/light/selection state is exposed to assistive technology.
- All custom artwork and video prompt values are preserved. Taco, church, horse and ring emoji choices were removed; the diamond has no background or border in the preview or captured media.

## Validation

`tests/booth.cjs` exercises actual Chromium rendering, simulated media, trusted touchscreen pinch input, IndexedDB and file downloads. It covers seven viewport sizes, automatic camera startup, permission recovery, sticker controls, rotation, countdown, manual and automatic video stop, microphone denial, archive failure and simulated Drive responses. All external browser requests are intercepted; real Drive uploads are deliberately excluded.

## Remaining external limits

- A volume-only Bluetooth remote remains incompatible with the web app on iPad Safari: iPadOS handles ordinary volume changes without a webpage shutter event. The [UI Events key-value specification](https://github.com/w3c/uievents-key/blob/gh-pages/index-source.txt) names optional Camera and AudioVolumeUp keyboard events; it does not guarantee their delivery on iPad. Physical hardware validation requires the actual remote. Use a keyboard mode if available, a keyboard-style remote, or native camera software.

- Real iPad Safari camera permissions, file sharing, screen wake lock and AirPrint require device validation. Browsers retain authority over automatic camera access and screen sleep.
- The Google Apps Script receiver is outside this repository. Its availability, upload limits and abuse controls cannot be established or fixed from this client. The endpoint is public in the browser; any authorization, type/size checks and quotas must be enforced by the receiver. Client code cannot hide a writable secret.
- `?admin=1` is a local archive UI switch, not authentication. The archive belongs to this browser profile. Use Guided Access for the booth and restrict physical access to the owner device.
- Local media remains subject to browser storage quota/eviction. Guests can download/share captures even if local archiving fails; keep the owner's device and verify Drive synchronization before clearing browser data.

## Design research

The publicly available [frontend design guidance](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) identifies repetitive AI design examples: cream-and-serif layouts, rounded card kits, ornamental gradients, numbered nonsequential items, eyebrow labels and generic copy. The redesign avoids these as a template: restrained neutral camera chrome, the existing BRIXPIX pink accent, functional color controls, custom wedding artwork and plain control labels. Gradients are limited to the requested screen-light falloff. Search and Nielsen Norman Group article access were blocked by the environment's network policy; no findings from those pages are claimed.
