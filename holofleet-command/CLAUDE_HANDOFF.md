# AI Handoff Document (for Claude) — Aether Room XR: Living Room Fleet Command

## 1. Project Overview
**Aether Room XR: Living Room Fleet Command** is a Meta Quest 3 Passthrough WebXR & Desktop real-time tactical spaceship defense (RTS) game built with **React 19, TypeScript, Vite, Tailwind CSS v4, and Three.js**.

Players defend their living room from up to 3 customizable AI fleets (up to 4 total commanders) in a floating holographic arena bounded by their living room Guardian walls and furniture anchors.

### Live Deployment URLs
- **Shared / Public App URL (use in Meta Quest Browser for top-level WebXR)**:
  `https://ais-pre-3qfd3smkvtg663b4gxzaxo-454911322812.us-west1.run.app`
- **Direct Auto-Launch Full Immersive URL**:
  `https://ais-pre-3qfd3smkvtg663b4gxzaxo-454911322812.us-west1.run.app/?autostart=1&immersive=1`
- **Development App URL**:
  `https://ais-dev-3qfd3smkvtg663b4gxzaxo-454911322812.us-west1.run.app`

---

## 2. File Tree & Architecture
```text
/
├── index.html                        # App entry HTML + Web App Manifest & meta tags
├── metadata.json                     # Permissions: ["camera", "microphone", "xr-spatial-tracking"]
├── package.json                      # React 19, Three.js, Vite, Tailwind v4, vite-plugin-pwa
├── vite.config.ts                    # Vite + PWA manifest configuration (standalone display)
├── public/
│   ├── pwa-192x192.png               # Quest 3 / PWA icon (192x192)
│   └── pwa-512x512.png               # Quest 3 / PWA icon (512x512)
└── src/
    ├── main.tsx                      # React root mount + Service Worker registration
    ├── index.css                     # Tailwind CSS + display/mono fonts + HUD stroke utilities
    ├── App.tsx                       # Top-level game state ('title' | 'playing' | 'paused' | 'gameover'),
    │                                 # immersiveMode state, Web Speech API voice controller, keyboard shortcuts
    ├── game/
    │   ├── types.ts                  # All TypeScript interfaces (UnitType, BuildingType, FactionState,
    │   │                             # WristWatchPanelState, RoomVantageAngle, SelectedUnitInfo, etc.)
    │   ├── rules.ts                  # Pure game logic: slower dramatic ship speeds, 3-tier base upgrade
    │   │                             # rules, 5 dedicated ore asteroids per station (20 total),
    │   │                             # direct unit move/attack/mine order helpers, 360° room vantage presets,
    │   │                             # voice command natural-language parser, and match scoring
    │   ├── rules.test.ts             # 7 Node.js unit tests (`npx tsx --test src/game/rules.test.ts`)
    │   ├── HoloModels.ts             # Procedural Three.js holographic wireframe + translucent core models:
    │   │                             # - Living Room environment, Guardian walls, & floating battle deck
    │   │                             # - 9-part Space Station with Tier 1/2/3 rings & orbiting tech modules
    │   │                             # - Ship models (Miner, Interceptor, Frigate, Cruiser, Leviathan Carrier,
    │   │                             #   Micro-Drone, Hero Flagship) + selection rings
    │   │                             # - Articulated 3D Left & Right Virtual Hands + Left-Wrist Chrono-Watch
    │   │                             #   with dynamic CanvasTexture & 12 raycastable 3D hologram buttons
    │   └── soundAndHaptics.ts        # Web Audio API procedural laser/explosion/warp synth +
    │                                 # WebXR Gamepad hapticActuators dual-controller rumble
    └── components/
        ├── TacticalXRViewport.tsx    # Core Three.js WebGL/WebXR simulation loop, raycasting (3D wristwatch
        │                             # first, then floating arena plane), unit AI, particle ring buffer,
        │                             # WebXR `immersive-ar` / `immersive-vr` session management
        ├── BattleSetupLobby.tsx      # Title screen 4-player skirmish configurator (Army Color, Hero,
        │                             # Team 1-4, AI Difficulty) + "Enter Full Immersive XR Mode" CTA
        ├── TacticalHUD.tsx           # Active gameplay HUD + Full Immersive 3D Visor mode (hides 2D docks
        │                             # when `immersiveMode` is true)
        ├── QuestSideloadModal.tsx    # Interactive modal for Quest 3 WebXR launch, PWA install, & APK build
        └── StatusModal.tsx           # Pause, Victory, and Defeat modal overlays
```

---

## 3. Completed Features & Mechanics
1. **3-Tier Space Station Base & Tech Tree (`src/game/rules.ts`)**:
   - **Tier 1 Outpost**: Starts with 2 Astro Miner Drones + 2 Dart Interceptors. Can build **Ore Refinery** (`+35%` mining yield) and **Sensor Array** (unlocks Tier 2).
   - **Tier 2 Citadel**: Requires Sensor Array. Unlocks **Orbital Shipyard** & **Furniture Laser Defense Grid**, plus **Pulse Frigates** and **Plasma Cruisers**.
   - **Tier 3 Bastion**: Requires Orbital Shipyard + Defense Grid. Unlocks **Titan Carrier Foundry** and **Leviathan Titan Carriers** that autonomously spawn micro-drone swarms (`micro_drone`).
2. **Slower Dramatic Ship Movement & 20 Station-Clustered Ore Asteroids**:
   - Ship speeds in `UNIT_SPECS` (`src/game/rules.ts`) are tuned for dramatic capital-ship engagements (`miner: 2.0`, `interceptor: 3.4`, `frigate: 2.4`, `cruiser: 1.75`, `carrier: 1.15`).
   - Map size is `44m × 44m` (`MAP_HALF_EXTENT = 20.5`).
   - `createInitialAsteroids()` spawns **5 dedicated Ore Asteroids in an arc around each of the 4 stations (20 total)**. Miners prioritize their home station's 5 asteroids.
3. **Direct Mouse & VR Hand-Controller Unit Selection + Move/Attack/Mine Orders**:
   - Left-click / VR trigger on a friendly ship selects it (green rotating `selection_ring` + trajectory line).
   - Clicking an enemy ship or enemy station issues a direct **Target Lock / Siege Order** (red marker + trajectory line).
   - Clicking an asteroid with a Miner selected assigns it to mine that asteroid.
   - Clicking empty space on the floating battle plane issues a **Move Order** (emerald marker + trajectory line).
4. **Living Room Boundaries as the Level + Floating Battle Arena + 3D Virtual Hands & Wristwatch**:
   - `createLivingRoomEnvironment()` in `src/game/HoloModels.ts` builds the Guardian room boundary walls, floor grid, coffee table holoprojector emitter cone, sofa, media wall, bookshelf, and credenza, plus `floatingDeck` suspended in the center of the room.
   - `createQuestHandControllerMesh('left' | 'right')` creates articulated 3D virtual hands (palm + 15 finger phalanges that animate pinch gestures).
   - The **Left Virtual Hand** wears a 3D **Chrono-Wristwatch** that projects an adjustable floating holographic panel (`CHRONO-WRIST TACTICAL HOLO`) with 12 raycastable 3D buttons:
     `PIN IN ROOM`, `MINIMIZE`, `LEVEL -`, `LEVEL +`, `SIZE -`, `SIZE +`, `T-`, `T+`, `+ MINER`, `+ DART`, `+ FRIGATE`, `+ CARRIER`, `UPGRADE TIER`, `SELECT FLEET`.
   - Players can walk around the room (`WASD` / Arrow keys) or snap to 6 room vantages (`South Sofa`, `East Wall`, `North TV`, `West Shelf`, `Room Eye-Level`, `Overhead`).
5. **Full Immersive Mode (`immersiveMode`)**:
   - Clicking **"Enter Full Immersive XR Mode"** on the Title Screen or HUD synchronously requests a WebXR `immersive-ar` (or fallback `immersive-vr`) session if supported by the headset, or enters Fullscreen First-Person 3D Room-Walk mode (`center_walk`) with the 2D HUD panels hidden and the 3D Virtual Hands + 3D Wristwatch front and center.

---

## 4. Next Immediate Task (User's Last Request Before Handoff)
Just before requesting this handoff, the user selected the main WebGL `<canvas>` element (`div#root > main > div > div:nth-of-type(2) > canvas`) in Focus Mode and said:
> **"this should all be in passthrough"**

### Why the User Saw a Dark Background Instead of True Passthrough:
1. **CSS Background Opaque Layers (`src/App.tsx` & `src/components/TacticalXRViewport.tsx`)**:
   - `<main>` in `src/App.tsx` (line 257) has `bg-[#040812]`.
   - The wrapper `<div>` in `src/components/TacticalXRViewport.tsx` (line 2255) ALSO has `bg-[#040812]`, and line 2261 has a dark radial gradient (`rgba(15, 23, 42, 0.82) 60%, rgba(4, 8, 18, 0.95) 100%`) over the `<video>` feed.
   - Inside `createLivingRoomEnvironment()` in `src/game/HoloModels.ts` (lines 106–119), `floorMat` has a dark navy color (`0x050b18`) with `opacity: 0.55` that darkens the center of the scene.
2. **WebGL Clear Alpha & Passthrough Simulation**:
   - In `src/components/TacticalXRViewport.tsx`, `renderer.setClearColor(0x000000, 0)` was only called inside `startWebXRPassthrough()` after a WebXR session started, rather than whenever `passthroughActive` is `true`.
   - When running in a regular browser window or when camera permission is denied/unavailable on desktop, the user wants the **entire `<canvas>` and background to look like a real Quest 3 Passthrough living room** (transparent WebGL canvas `renderer.setClearColor(0x000000, 0)`, live camera `<video>` feed at full brightness when available, and a bright, realistic sunlit/warm-lit 3D/CSS living-room passthrough backdrop instead of a pitch-black `#040812` space void).

### Recommended Steps for Claude to Complete This Task:
1. **Make the WebGL `<canvas>` 100% Transparent in Passthrough Mode (`src/components/TacticalXRViewport.tsx`)**:
   - Set `renderer.setClearColor(0x000000, 0)` on initialization and keep `scene.background = null` and `scene.fog = null` whenever `passthroughActive` is `true`.
   - Remove `bg-[#040812]` from `<main>` in `src/App.tsx` and the outer wrapper `<div>` in `src/components/TacticalXRViewport.tsx` when `passthroughActive` is `true` (`bg-transparent`).
2. **Upgrade the Passthrough Underlay (`src/components/TacticalXRViewport.tsx` & `src/game/HoloModels.ts`)**:
   - Make the `<video ref={videoRef}>` webcam/passthrough feed full opacity (`opacity-100`) without the dark `0.95` navy radial vignette covering it.
   - When no physical camera stream is active (or on desktop/headless preview), render a realistic **Quest 3 Passthrough Living Room Environment** (warm hardwood floor, sunlit living-room walls, ceiling light, and physical furniture silhouettes) with the cyan holographic Chaperone grid and floating space battle layered transparently on top so the entire viewport unmistakably reads as **Mixed Reality Passthrough** rather than dark outer space.
   - In `createLivingRoomEnvironment()` (`src/game/HoloModels.ts`), set the floor mesh opacity to `0` (or shadow-catcher only) when `passthroughActive` is `true` so it never darkens the passthrough feed.

---

## 5. Verification Commands
- **Run Unit Tests (7 tests)**:
  ```bash
  npx tsx --test src/game/rules.test.ts
  ```
- **Typecheck & Lint**:
  ```bash
  npm run lint
  ```
- **Production Build**:
  ```bash
  npm run build
  ```
