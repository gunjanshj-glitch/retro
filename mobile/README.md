# Retro Holidays app (Expo)

Plan and live status table: [`docs/mobile/README.md`](../docs/mobile/README.md).

```bash
cd mobile
npm install
npx expo start          # open in Expo Go on an iPhone
npm run typecheck
```

- Talks to `https://retroholidays.in/api/v1` by default. Point at another Worker with `EXPO_PUBLIC_API_URL=...`.
- Shared TypeScript lives in `../packages/*` (`@retro/core`, `@retro/api-client`, `@retro/chat-flow`); Metro reads them through `metro.config.js`.
- This folder is deliberately **not** an npm workspace of the website: React versions differ.
- Store-account values (bundle id, EAS project id) come from the environment, so the app runs in Expo Go with none of them.
