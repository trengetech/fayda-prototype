# Start here — handing Fayda to Claude Code

## 1. Set up (on your machine)

1. Create a **new private Git repository under your own (or your company's) account**, e.g. `fayda`.
2. Unzip this package into the repository root and commit it as-is ("Prototype + handoff").
3. Install the tools Claude Code will need:
   - Node.js LTS
   - pnpm (`corepack enable`)
   - Docker Desktop
   - Android Studio with an emulator (or a physical Android phone with USB debugging)
   - Git
   - An Expo account (needed later for EAS builds)
4. Open the repository folder in Claude Code.

## 2. Paste this as your first message in Claude Code

```
Read CLAUDE.md, docs/DECISIONS.md and prototype/README.md, then explore prototype/
(run the prototype and its tests if you can: `node --test prototype/test/engine.test.js`).

We're starting milestone M3.0 (Foundation + design system) for the Android Buyer and
Seller apps described in CLAUDE.md. Don't write app code yet. First give me:
1. Your understanding of the product and the M3.0 scope, in under 15 lines.
2. The exact versions you'll use for Expo SDK, React Native, Expo Router, expo-video,
   NestJS + Fastify adapter, Drizzle, Zod and the Zod→OpenAPI and RHF tooling —
   checked as current, stable and compatible with each other.
3. The repository layout and the list of packages you'll create.
4. How you'll port prototype/src/engine.js and its tests into packages/domain and the API
   (including how the 5-second auto-counter and the expiry sweeps will run).
5. Any risks, missing decisions, or libraries outside the agreed stack that you want approved.
Wait for my approval before implementing.
```

## 3. After each milestone

Ask Claude Code to:
- show the acceptance criteria with pass or fail for each;
- run typecheck, lint and tests;
- update `docs/PROGRESS.md`.

Then review it on a real Android phone before approving the next milestone.
