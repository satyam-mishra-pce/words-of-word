# Capacitor mobile delivery

Words of Word ships one React bundle through the existing web app and native iOS/Android shells in `apps/web/ios` and `apps/web/android`.

The native shell is deliberately edge-to-edge. The React surface paints behind the system bars, while `NativeAppBridge` applies safe-area padding, status/navigation-bar contrast, keyboard behavior, haptics, deep-link routing, and notification listeners.

## Build a native bundle

```bash
cp apps/web/.env.mobile.example apps/web/.env.mobile
# Set both values to real, public HTTPS endpoints.
pnpm mobile:sync
pnpm mobile:ios
pnpm mobile:android
```

`cap:build` refuses to build if `VITE_SOCKET_URL` or `VITE_PUBLIC_WEB_URL` is missing or non-HTTPS. A packaged app must never fall back to `capacitor://localhost` for Socket.IO or invitation links.

`VITE_SOCKET_URL` is the Fastify/Socket.IO origin. `VITE_PUBLIC_WEB_URL` is the canonical public web origin used in shared room links. They can be the same origin when Fastify serves the web bundle. `cap:build` verifies that the public URL host exactly matches both the Android App Link filters and iOS `APP_LINK_HOST`, preventing a mismatched release bundle.

If production sets `CLIENT_ORIGIN` instead of leaving CORS open, include the Capacitor WebView origins alongside the public site (normally `capacitor://localhost` for iOS and `https://localhost` for Android), then verify them on real devices.

## Native project setup

### iOS

1. Open `apps/web/ios/App/App.xcodeproj` in Xcode.
2. Select your Apple development team and confirm that `com.wordsofword.game` is an identifier you own before any store submission.
3. Enable **Push Notifications** for that App ID and use an APNs-capable provisioning profile. The checked-in entitlements use `$(APS_ENVIRONMENT)` for Debug/Release.
4. Set `APP_LINK_HOST` in the App target build settings to the same host as `VITE_PUBLIC_WEB_URL` (without `https://`).
5. Test on a real notched iPhone, both themes, with the keyboard open and a room link opened from Messages.

### Android

1. Open `apps/web/android` in Android Studio and use Java 21 or the JDK recommended by the Android Gradle Plugin. Do not use an unsupported newer JDK for Gradle sync.
2. For Firebase Cloud Messaging, place your private `google-services.json` in `apps/web/android/app/`; it is intentionally not committed. The generated Gradle project enables the Google Services plugin only when that file is present.
3. Update the HTTPS intent-filter host in `AndroidManifest.xml` if the canonical host changes.
4. Verify both gesture and three-button navigation on Android 15+. Android 15 enforces edge-to-edge; bar colors are a contrast hint, not the layout mechanism.

The `wordsofword://join/ROOM` custom scheme works immediately on both platforms. The canonical HTTPS route gives install-or-web fallback once Universal Links/App Links are verified.

## Verified HTTPS room links

The Fastify server now serves the association files when the corresponding deployment values exist:

```bash
MOBILE_APP_ID=com.wordsofword.game
IOS_APP_TEAM_ID=ABCDE12345
ANDROID_APP_LINK_CERTIFICATES=AA:BB:...:FF[,SECOND_CERTIFICATE]
PUBLIC_WEB_URL=https://words-of-word.example.com
```

- `/.well-known/apple-app-site-association` uses `IOS_APP_TEAM_ID` and `MOBILE_APP_ID` for room and daily routes.
- `/.well-known/assetlinks.json` uses `ANDROID_APP_LINK_CERTIFICATES` and `MOBILE_APP_ID` for room and daily routes.

Those values must match the signed store builds exactly. The default `words-of-word.onrender.com` native host is only a development placeholder; change iOS, Android, and deployment configuration together before release.

## Push alerts

The app prompts only after a player intentionally taps **Enable** on the native home screen. It registers an APNs token on iOS or FCM token on Android and sends the token to the game server using the stable installation session. Native lifecycle events mark a player inactive before backgrounding, so a round reminder can be sent even when the WebSocket has not yet been torn down.

The server can deliver round reminders through a private relay:

```bash
PUSH_RELAY_URL=https://your-private-push-relay.example/send
PUSH_RELAY_TOKEN=server-only-secret
```

The relay receives:

```json
{
  "token": "device-token",
  "platform": "ios",
  "notification": { "title": "...", "body": "...", "channelId": "game-alerts" },
  "data": { "kind": "round-started", "roomId": "ABC123", "url": "https://.../join/ABC123" }
}
```

The relay—not the mobile app—must hold APNs/FCM credentials and translate this request to the correct provider. The current game has no accounts/friends or recipient picker, so direct person-to-person *push* invitations require that product model. Native sharing already provides invitation links; notification infrastructure currently sends round reminders to registered, temporarily disconnected players.

Push token storage is intentionally in-memory in the present single-process server, like rooms. Before a scalable production launch, move both rooms and tokens to durable infrastructure and replace the relay boundary with a provider-backed service.

## Mobile session recovery

Capacitor devices routinely suspend sockets. A UUID installation ID is stored in Capacitor Preferences and sent in Socket.IO auth. The server keeps a disconnected player for `MOBILE_RECONNECT_GRACE_MS` (90 seconds by default), uses Socket.IO connection-state recovery when possible, and otherwise atomically rebinds a fresh socket ID to every score/team/round data structure.

This ID is continuity only, **not authentication**. It must not be used to authorize accounts, purchases, friendships, or arbitrary notification sends.

## Native extension seam

All Capacitor-only wiring lives in:

- `src/components/NativeAppBridge.tsx` — lifecycle, deep links, system bars, keyboard, push listeners;
- `src/services/nativeFeedback.ts` — haptics;
- `src/services/nativeShare.ts` — share sheet;
- `src/services/nativePush.ts` — permission/token handling; and
- `src/services/storage.ts` — Preferences-backed non-secret state.

Keep page components calling these small services rather than importing iOS/Android APIs directly. If a future feature needs bespoke Swift or Kotlin code, add a focused Capacitor plugin and expose it through this same service layer; the web fallback can remain a no-op or browser equivalent.

## Required device QA

Before submitting stores, verify on real hardware:

1. cold-start, background/resume, network handoff, and reconnect during a round;
2. custom-scheme and verified HTTPS room links from Messages/WhatsApp;
3. status bar, home indicator/navigation bar, dialogs, and keyboard in dark and light themes;
4. notification permission, APNs/FCM registration, foreground delivery, tapped-notification routing, and denied permission;
5. iPhone and Android app icons/splash screens; and
6. Android 15 gesture and three-button navigation.
