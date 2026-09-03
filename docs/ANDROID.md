# Android and tablet build

**Status: the web client is landscape-ready and the touch layout is implemented. The Android project has not been generated or built.** Nothing in this document has been run end to end; treat it as the plan, not a report.

## Why the same client

The table is a single-page app that talks to the match server over HTTP and Socket.IO. There is no browser-only API in the play path, so Capacitor can wrap the same `apps/client` build instead of maintaining a second UI. That keeps the rules engine, the projections and the interaction model identical across web, Android and (later) desktop via Tauri.

## Orientation

**The Android and tablet builds play in landscape only.** Commander needs three opponent boards side by side; stacking them vertically on a phone makes every board too short to read.

The client already reflects this:

| Context | Layout |
| --- | --- |
| Desktop, any size | Opponents in a row, hand fanned, hover preview available |
| Touch device in landscape (`(orientation: landscape) and (pointer: coarse)`) | Same shape, but the board shrinks and the hand grows past it — the hand is the control surface on a touch screen, the way MTG Arena treats it. Tap targets clear 34–44px, the hover preview is disabled. |
| Short landscape (`max-height: 520px`, a phone held sideways) | Chrome trimmed: shorter topbar, compact phase rail, hidden hand label and zone captions |
| Portrait, narrow (`(orientation: portrait) and (max-width: 900px)`) | Not a supported play orientation. Boards stack so the state stays readable, the hand becomes a scroll-snapped strip, and a hint asks the player to rotate. |

The `▭` button in the topbar forces the touch layout on a desktop (`data-layout="mobile"`, stored in `localStorage`) so the proportions can be checked without a device.

## Size targets

| Device | Viewport (landscape) | Notes |
| --- | --- | --- |
| Phone | 915 × 412 up to 1080 × 500 | The tightest case. Board cards land near 30–36px wide, hand cards near 100–120px. |
| Small tablet | 1024 × 768 | Comfortable; close to the desktop proportions. |
| Large tablet | 1280 × 800 and up | Uses the desktop layout unchanged. |

## Setup, when it is time to build

```bash
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/android
npx cap init ProsshTCG com.prossh.tcg --web-dir=apps/client/dist
npm run build --workspace=@prossh/client
npx cap add android
npx cap sync android
npx cap open android      # requires Android Studio and a JDK
```

`capacitor.config.ts` at the repository root should set:

```ts
export default {
  appId: "com.prossh.tcg",
  appName: "ProsshTCG",
  webDir: "apps/client/dist",
  android: { allowMixedContent: false },
  server: { androidScheme: "https" }
};
```

Lock the orientation in `android/app/src/main/AndroidManifest.xml`:

```xml
<activity
    android:name=".MainActivity"
    android:screenOrientation="sensorLandscape"
    android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode" />
```

`sensorLandscape` rather than `landscape` so the device can be held either way round.

## Open work before an Android build is worth making

1. **The server address.** The web client uses relative `/api` paths proxied by Vite. A packaged app has no proxy, so the client needs a configurable base URL (build-time env var plus an in-app setting) and the server needs a CORS origin that is not `http://localhost:5173`.
2. **Persistence.** Matches live in one process's memory today, so closing the app loses the game. Reconnect needs the persistent match store from the handoff's next-steps list.
3. **Asset policy.** Card images are linked from the provider on demand. A packaged app that caches them to disk is a redistribution question, not a performance one — settle the licence before adding an image cache.
4. **Touch affordances not yet built.** Long-press for the card detail (the hover preview is disabled on touch), drag-to-attack, and pinch-zoom on a board.
5. **Safe areas.** Add `viewport-fit=cover` and `env(safe-area-inset-*)` padding once there is a device with a notch to test against.
