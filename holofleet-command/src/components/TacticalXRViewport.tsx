import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ARMY_COLORS,
  AI_DIFFICULTY_MULTIPLIERS,
  BUILDING_SPECS,
  HERO_COMMANDERS,
  MAP_HALF_EXTENT,
  ROOM_VANTAGE_PRESETS,
  UNIT_SPECS,
  calculateMatchScore,
  canBuildStructure,
  canDeployUnit,
  canUpgradeBaseTier,
  constructStructure,
  createInitialAsteroids,
  createInitialFactions,
  evaluateMatchOutcome,
  issueMoveOrderToUnits,
  issueTargetOrderToUnits,
  mapRoomWorldToArenaCoords,
  upgradeBaseTier,
} from '../game/rules';
import {
  WristWatchActionId,
  createLivingRoomEnvironment,
  createQuestHandControllerMesh,
  createSpaceStationGroup,
  createUnitHoloMesh,
  syncStationVisuals,
} from '../game/HoloModels';
import { soundAndHaptics } from '../game/soundAndHaptics';
import {
  AsteroidEntity,
  BuildingType,
  FactionState,
  GameState,
  LaserBeamEvent,
  PlayerSlotConfig,
  RoomVantageAngle,
  RunSummarySnapshot,
  SelectedUnitInfo,
  TacticalStance,
  UnitEntity,
  UnitType,
  VoiceCommandIntent,
  WristWatchPanelState,
} from '../game/types';

export interface SimulationCommandAPI {
  deployUnit: (unitType: UnitType) => boolean;
  buildStructure: (buildingType: BuildingType) => boolean;
  upgradeTier: () => boolean;
  triggerHeroAbility: () => boolean;
  setStance: (stance: TacticalStance) => void;
  selectUnitsByFilter: (filter: UnitType | 'all_combat' | 'all' | 'clear') => void;
  clearSelectedUnitOrders: () => void;
  executeVoiceCommand: (intent: VoiceCommandIntent) => string;
  executeWristWatchAction: (action: WristWatchActionId) => void;
  setRoomVantage: (vantage: RoomVantageAngle) => void;
  setFloatingLevelConfig: (patch: Partial<WristWatchPanelState>) => void;
  startWebXRPassthrough: () => Promise<boolean>;
  exitFullImmersiveMode: () => void;
  resetMatch: (slots: PlayerSlotConfig[]) => void;
}

interface TacticalXRViewportProps {
  gameState: GameState;
  playerSlots: PlayerSlotConfig[];
  passthroughActive: boolean;
  immersiveMode: boolean;
  furnitureBlend: number;
  onTogglePassthrough: () => void;
  onImmersiveModeChange: (active: boolean) => void;
  onAdjustFurnitureBlend: (nextBlend: number) => void;
  onHudSync: (
    factions: FactionState[],
    unitCounts: Record<UnitType, number>,
    selectedUnits: SelectedUnitInfo[],
    wristWatch: WristWatchPanelState,
    elapsedSec: number
  ) => void;
  onMatchEnd: (summary: RunSummarySnapshot) => void;
  onStatusToast: (msg: string) => void;
  apiRef: React.MutableRefObject<SimulationCommandAPI | null>;
}

// Pre-allocated scratch math helpers outside the animation loop (Zero GC)
const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchUp = new THREE.Vector3();
const _scratchMat4 = new THREE.Matrix4();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();
const _rayPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.65);

interface PooledParticle {
  active: boolean;
  isAmbient: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  colorHex: number;
}

export const TacticalXRViewport: React.FC<TacticalXRViewportProps> = ({
  gameState,
  playerSlots,
  passthroughActive,
  immersiveMode,
  furnitureBlend,
  onTogglePassthrough,
  onImmersiveModeChange,
  onAdjustFurnitureBlend,
  onHudSync,
  onMatchEnd,
  onStatusToast,
  apiRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const gameStateRef = useRef<GameState>(gameState);
  gameStateRef.current = gameState;

  const passthroughRef = useRef<boolean>(passthroughActive);
  passthroughRef.current = passthroughActive;

  const immersiveModeRef = useRef<boolean>(immersiveMode);
  immersiveModeRef.current = immersiveMode;

  const furnitureBlendRef = useRef<number>(furnitureBlend);
  furnitureBlendRef.current = furnitureBlend;

  const callbacksRef = useRef({
    onHudSync,
    onMatchEnd,
    onStatusToast,
    onTogglePassthrough,
    onImmersiveModeChange,
    onAdjustFurnitureBlend,
  });
  callbacksRef.current = {
    onHudSync,
    onMatchEnd,
    onStatusToast,
    onTogglePassthrough,
    onImmersiveModeChange,
    onAdjustFurnitureBlend,
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (passthroughActive && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then((s) => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch(() => {});
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [passthroughActive]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const xrSupportCache = { ar: false, vr: false };
    const probeNavXR = (navigator as unknown as { xr?: XRSystem }).xr;
    if (probeNavXR && typeof probeNavXR.isSessionSupported === 'function') {
      probeNavXR
        .isSessionSupported('immersive-ar')
        .then((ok) => {
          xrSupportCache.ar = Boolean(ok);
        })
        .catch(() => {});
      probeNavXR
        .isSessionSupported('immersive-vr')
        .then((ok) => {
          xrSupportCache.vr = Boolean(ok);
        })
        .catch(() => {});
    }

    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;

    const initRect = container.getBoundingClientRect();
    renderer.setSize(initRect.width || window.innerWidth, initRect.height || window.innerHeight);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      54,
      (initRect.width || window.innerWidth) / (initRect.height || window.innerHeight),
      0.1,
      220
    );
    camera.position.set(0, 16.5, 24.5);
    camera.lookAt(0, 2.2, 2.0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 3.5;
    controls.maxDistance = 56;
    controls.target.set(0, 2.2, 2.0);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // 3-Point Warm/Cool Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x091326, 1.15);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4d6, 1.85);
    keyLight.position.set(14, 28, 18);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -24;
      keyLight.shadow.camera.right = 24;
      keyLight.shadow.camera.top = 24;
      keyLight.shadow.camera.bottom = -24;
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 0.95);
    rimLight.position.set(-18, 14, -18);
    scene.add(rimLight);

    // 1. Passthrough Room Boundaries & Living Room Furniture (The Room itself IS the Level!)
    const livingRoom = createLivingRoomEnvironment();
    scene.add(livingRoom.root);

    // 2. Floating Battle Arena Root (Suspended in the middle of the living room!)
    const battleArenaRoot = new THREE.Group();
    battleArenaRoot.position.set(0, 0.6, 0);
    scene.add(battleArenaRoot);

    // 3. Articulated 3D Virtual Hands (Left Hand has Chrono-Wristwatch + Floating Adjustable Panel)
    const leftHandRig = createQuestHandControllerMesh('left', 0x06b6d4);
    leftHandRig.group.position.set(-4.2, 4.8, 15.5);
    scene.add(leftHandRig.group);

    const rightHandRig = createQuestHandControllerMesh('right', 0x38bdf8);
    rightHandRig.group.position.set(4.2, 4.8, 15.5);
    scene.add(rightHandRig.group);

    // Wristwatch & Floating Living Room Level State
    const wristWatchState: WristWatchPanelState = {
      open: true,
      pinnedInRoom: false,
      panelScale: 1.0,
      panelTiltDeg: 0,
      battleElevationY: 1.65, // Battle floats 1.65m above the living room floor!
      roomBoundaryScale: 1.0,
      activeVantage: 'south_sofa',
    };

    let cameraTransitionTarget: {
      camPos: THREE.Vector3;
      lookTarget: THREE.Vector3;
      timer: number;
    } | null = null;
    let pointerPinchActiveTimer = 0;

    // Tactical Aim / Order Reticle on Floating Battle Plane
    const reticleGroup = new THREE.Group();
    const retOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.65, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    retOuter.rotation.x = -Math.PI / 2;
    const retInner = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 24),
      new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    retInner.rotation.x = -Math.PI / 2;
    reticleGroup.add(retOuter, retInner);
    reticleGroup.position.set(0, 1.15, 0);
    battleArenaRoot.add(reticleGroup);

    // Waypoint & Target Order Indicator Ring
    const orderMarkerGroup = new THREE.Group();
    const orderMarkerMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const orderMarkerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.62, 28),
      orderMarkerMat
    );
    orderMarkerRing.rotation.x = -Math.PI / 2;
    orderMarkerGroup.add(orderMarkerRing);
    orderMarkerGroup.visible = false;
    battleArenaRoot.add(orderMarkerGroup);

    // Zero-GC Pooled Particle Ring Buffer (320 particles inside Floating Battle Arena)
    const PARTICLE_CAP = 320;
    const particleGeo = new THREE.OctahedronGeometry(0.08, 0);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    const particleInstanced = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_CAP);
    particleInstanced.frustumCulled = false;
    battleArenaRoot.add(particleInstanced);

    const particles: PooledParticle[] = [];
    for (let i = 0; i < PARTICLE_CAP; i++) {
      const isAmbient = i < 140;
      particles.push({
        active: isAmbient,
        isAmbient,
        x: (Math.random() - 0.5) * 38,
        y: 0.3 + Math.random() * 4.5,
        z: (Math.random() - 0.5) * 38,
        vx: (Math.random() - 0.5) * 0.2,
        vy: 0.06 + Math.random() * 0.14,
        vz: (Math.random() - 0.5) * 0.2,
        life: Math.random() * 10,
        maxLife: 10,
        scale: isAmbient ? 0.6 + Math.random() * 0.9 : 1,
        colorHex: i % 2 === 0 ? 0x22d3ee : 0x818cf8,
      });
    }

    let burstRingCursor = 140;
    const spawnParticleBurst = (
      x: number,
      y: number,
      z: number,
      colorHex: number,
      count: number,
      speedScale = 3.5
    ) => {
      for (let i = 0; i < count; i++) {
        const p = particles[burstRingCursor];
        burstRingCursor = 140 + ((burstRingCursor - 140 + 1) % (PARTICLE_CAP - 140));
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const spd = (0.4 + Math.random() * 0.8) * speedScale;
        p.active = true;
        p.isAmbient = false;
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = Math.sin(phi) * Math.cos(theta) * spd;
        p.vy = Math.cos(phi) * spd;
        p.vz = Math.sin(phi) * Math.sin(theta) * spd;
        p.life = 0.55 + Math.random() * 0.5;
        p.maxLife = p.life;
        p.scale = 1.2 + Math.random() * 1.3;
        p.colorHex = colorHex;
      }
    };

    const stationsRoot = new THREE.Group();
    const asteroidsRoot = new THREE.Group();
    const unitsRoot = new THREE.Group();
    const lasersRoot = new THREE.Group();
    const orderLinesRoot = new THREE.Group();
    battleArenaRoot.add(stationsRoot, asteroidsRoot, unitsRoot, lasersRoot, orderLinesRoot);

    let factions: FactionState[] = [];
    let asteroids: AsteroidEntity[] = [];
    let units: UnitEntity[] = [];
    let lasers: LaserBeamEvent[] = [];
    let matchElapsedSec = 0;
    let hudSyncTimer = 0;
    let cameraShakeTrauma = 0;
    let hitstopTimer = 0;
    let rallyPoint: { x: number; z: number } | null = null;
    let bestScoreRecorded = 2400;

    const stationMeshes = new Map<number, THREE.Group>();
    const asteroidMeshes = new Map<string, THREE.Group>();
    const unitMeshes = new Map<string, THREE.Group>();
    const laserMeshes = new Map<string, THREE.Line>();

    const applyFloatingArenaTransform = () => {
      // In WebXR headset passthrough, scale the 44m sector to a physical 4.2m room-scale holotable!
      const xrFactor = renderer.xr.isPresenting ? 0.095 : 1.0;
      const effScale = xrFactor * wristWatchState.roomBoundaryScale;
      battleArenaRoot.position.y = wristWatchState.battleElevationY - 1.05;
      battleArenaRoot.scale.setScalar(effScale);
      livingRoom.setFloatingArenaTransform(wristWatchState.battleElevationY, effScale);
      _rayPlane.constant = -(wristWatchState.battleElevationY + 0.1);
    };

    const spawnUnitEntity = (ownerSlot: number, type: UnitType, customOffset?: { x: number; z: number }) => {
      const faction = factions.find((f) => f.slotIndex === ownerSlot);
      if (!faction || faction.defeated) return null;
      const spec = UNIT_SPECS[type];
      const angle = Math.random() * Math.PI * 2;
      const dist = 1.8 + Math.random() * 1.1;
      const ux = (customOffset?.x ?? faction.position.x) + Math.cos(angle) * dist;
      const uz = (customOffset?.z ?? faction.position.z) + Math.sin(angle) * dist;
      const uy = 1.05 + (Math.random() - 0.5) * 0.45;

      const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const entity: UnitEntity = {
        id,
        ownerSlot,
        team: faction.team,
        type,
        policy: spec.policy,
        hp: spec.maxHp,
        maxHp: spec.maxHp,
        x: ux,
        y: uy,
        z: uz,
        vx: 0,
        vy: 0,
        vz: 0,
        rotationY: Math.atan2(-ux, -uz),
        targetId: null,
        attackCooldown: Math.random() * 0.3,
        carrierSpawnTimer: 3.2,
        miningLoad: 0,
        hitFlashTimer: 0,
        koTimer: 0,
        selected: false,
        manualMoveTarget: null,
        manualAttackTargetId: null,
        manualStationTargetSlot: null,
        manualAsteroidTargetId: null,
        orderLabel: spec.policy === 'harvester' ? 'Mining Station Asteroids' : 'Autonomous Fleet AI',
      };
      units.push(entity);

      const colorHex = ARMY_COLORS[faction.colorId]?.num ?? 0x06b6d4;
      const mesh = createUnitHoloMesh(type, colorHex);
      mesh.scale.setScalar(spec.scale);
      mesh.position.set(ux, uy, uz);
      unitsRoot.add(mesh);
      unitMeshes.set(id, mesh);
      return entity;
    };

    const initializeMatch = (slotsConfig: PlayerSlotConfig[]) => {
      stationsRoot.clear();
      asteroidsRoot.clear();
      unitsRoot.clear();
      lasersRoot.clear();
      orderLinesRoot.clear();
      stationMeshes.clear();
      asteroidMeshes.clear();
      unitMeshes.clear();
      laserMeshes.clear();

      factions = createInitialFactions(slotsConfig);
      asteroids = createInitialAsteroids();
      units = [];
      lasers = [];
      matchElapsedSec = 0;
      rallyPoint = null;
      orderMarkerGroup.visible = false;

      for (const f of factions) {
        const colorHex = ARMY_COLORS[f.colorId]?.num ?? 0x06b6d4;
        const stGroup = createSpaceStationGroup(colorHex);
        stGroup.position.set(f.position.x, f.position.y, f.position.z);
        stationsRoot.add(stGroup);
        stationMeshes.set(f.slotIndex, stGroup);

        // Starting fleet: 2 Astro Miner Drones + 2 Dart Interceptors
        spawnUnitEntity(f.slotIndex, 'miner');
        spawnUnitEntity(f.slotIndex, 'miner');
        spawnUnitEntity(f.slotIndex, 'interceptor');
        spawnUnitEntity(f.slotIndex, 'interceptor');
        f.supplyUsed = 4;
      }

      // Build 20 Holographic Asteroid meshes (5 around each of the 4 stations)
      for (const ast of asteroids) {
        const astGeo = new THREE.DodecahedronGeometry(ast.radius, 1);
        const astGroup = new THREE.Group();
        const ownerFac = factions.find((f) => f.slotIndex === ast.stationSlot);
        const tintHex = ownerFac ? ARMY_COLORS[ownerFac.colorId].num : 0x06b6d4;

        const coreMat = new THREE.MeshStandardMaterial({
          color: 0x0e7490,
          emissive: tintHex,
          emissiveIntensity: 0.35,
          roughness: 0.65,
          metalness: 0.35,
          transparent: true,
          opacity: 0.65,
        });
        const wireMat = new THREE.LineBasicMaterial({
          color: 0x67e8f9,
          transparent: true,
          opacity: 0.9,
        });
        astGroup.add(
          new THREE.Mesh(astGeo, coreMat),
          new THREE.LineSegments(new THREE.EdgesGeometry(astGeo), wireMat)
        );
        astGroup.position.set(ast.x, ast.y, ast.z);
        asteroidsRoot.add(astGroup);
        asteroidMeshes.set(ast.id, astGroup);
      }

      applyFloatingArenaTransform();
      syncHudImmediate();
    };

    const syncHudImmediate = () => {
      const human = factions.find((f) => f.isHuman);
      const counts: Record<UnitType, number> = {
        miner: 0,
        interceptor: 0,
        frigate: 0,
        cruiser: 0,
        carrier: 0,
        micro_drone: 0,
        hero_flagship: 0,
      };
      const selectedList: SelectedUnitInfo[] = [];

      if (human) {
        let used = 0;
        for (const u of units) {
          if (u.ownerSlot === human.slotIndex && u.koTimer === 0) {
            counts[u.type] = (counts[u.type] || 0) + 1;
            used += UNIT_SPECS[u.type].supplyCost;
            if (u.selected) {
              selectedList.push({
                id: u.id,
                type: u.type,
                name: UNIT_SPECS[u.type].name,
                hp: Math.round(u.hp),
                maxHp: u.maxHp,
                orderLabel: u.orderLabel || 'Ready for Orders',
              });
            }
          }
        }
        human.supplyUsed = used;

        leftHandRig.updateWatchDisplay?.({
          open: wristWatchState.open,
          pinnedInRoom: wristWatchState.pinnedInRoom,
          ore: human.ore,
          energy: human.energy,
          tier: human.baseTier,
          supplyText: `${human.supplyUsed}/${human.supplyCap}`,
          selectedCount: selectedList.length,
          battleElevationY: wristWatchState.battleElevationY,
          panelScale: wristWatchState.panelScale,
          panelTiltDeg: wristWatchState.panelTiltDeg,
        });
      }

      callbacksRef.current.onHudSync(
        factions.map((f) => ({ ...f, buildings: [...f.buildings] })),
        counts,
        selectedList,
        { ...wristWatchState },
        matchElapsedSec
      );
    };

    const handleWatchAction = (action: WristWatchActionId) => {
      pointerPinchActiveTimer = 0.25;
      switch (action) {
        case 'TOGGLE_PANEL':
          wristWatchState.open = !wristWatchState.open;
          soundAndHaptics.playVoiceAck();
          callbacksRef.current.onStatusToast(
            wristWatchState.open
              ? 'Left Wristwatch Hologram Panel Expanded'
              : 'Left Wristwatch Hologram Panel Minimized'
          );
          syncHudImmediate();
          break;
        case 'TOGGLE_PIN':
          wristWatchState.pinnedInRoom = !wristWatchState.pinnedInRoom;
          soundAndHaptics.playVoiceAck();
          callbacksRef.current.onStatusToast(
            wristWatchState.pinnedInRoom
              ? 'Wristwatch Panel Pinned Floating in Living Room Space!'
              : 'Wristwatch Panel Locked to Left Virtual Wrist'
          );
          syncHudImmediate();
          break;
        case 'HEIGHT_UP':
          wristWatchState.battleElevationY = Number(
            Math.min(2.6, wristWatchState.battleElevationY + 0.2).toFixed(2)
          );
          applyFloatingArenaTransform();
          soundAndHaptics.playVoiceAck();
          callbacksRef.current.onStatusToast(
            `Floating Battle Elevation raised to ${wristWatchState.battleElevationY.toFixed(2)}m`
          );
          syncHudImmediate();
          break;
        case 'HEIGHT_DOWN':
          wristWatchState.battleElevationY = Number(
            Math.max(0.55, wristWatchState.battleElevationY - 0.2).toFixed(2)
          );
          applyFloatingArenaTransform();
          soundAndHaptics.playVoiceAck();
          callbacksRef.current.onStatusToast(
            `Floating Battle Elevation lowered to ${wristWatchState.battleElevationY.toFixed(2)}m`
          );
          syncHudImmediate();
          break;
        case 'SCALE_UP':
          wristWatchState.panelScale = Number(
            Math.min(1.45, wristWatchState.panelScale + 0.15).toFixed(2)
          );
          soundAndHaptics.playVoiceAck();
          syncHudImmediate();
          break;
        case 'SCALE_DOWN':
          wristWatchState.panelScale = Number(
            Math.max(0.7, wristWatchState.panelScale - 0.15).toFixed(2)
          );
          soundAndHaptics.playVoiceAck();
          syncHudImmediate();
          break;
        case 'TILT_LEFT':
          wristWatchState.panelTiltDeg = Math.max(-30, wristWatchState.panelTiltDeg - 10);
          soundAndHaptics.playVoiceAck();
          syncHudImmediate();
          break;
        case 'TILT_RIGHT':
          wristWatchState.panelTiltDeg = Math.min(30, wristWatchState.panelTiltDeg + 10);
          soundAndHaptics.playVoiceAck();
          syncHudImmediate();
          break;
        case 'DEPLOY_MINER':
          apiRef.current?.deployUnit('miner');
          break;
        case 'DEPLOY_INTERCEPTOR':
          apiRef.current?.deployUnit('interceptor');
          break;
        case 'DEPLOY_FRIGATE':
          apiRef.current?.deployUnit('frigate');
          break;
        case 'DEPLOY_CARRIER':
          apiRef.current?.deployUnit('carrier');
          break;
        case 'UPGRADE_TIER':
          apiRef.current?.upgradeTier();
          break;
        case 'SELECT_COMBAT':
          apiRef.current?.selectUnitsByFilter('all_combat');
          break;
      }
    };

    const setRoomVantageCamera = (vantage: RoomVantageAngle) => {
      const preset = ROOM_VANTAGE_PRESETS[vantage] ?? ROOM_VANTAGE_PRESETS.south_sofa;
      wristWatchState.activeVantage = vantage;
      cameraTransitionTarget = {
        camPos: new THREE.Vector3(preset.camX, preset.camY, preset.camZ),
        lookTarget: new THREE.Vector3(preset.targetX, preset.targetY, preset.targetZ),
        timer: 0.65,
      };
      soundAndHaptics.playVoiceAck();
      callbacksRef.current.onStatusToast(`Room Walk-Around Vantage: ${preset.label}`);
      syncHudImmediate();
    };

    // Expose Command API to React HUD, Wristwatch & Voice Controller
    apiRef.current = {
      deployUnit: (unitType: UnitType) => {
        const human = factions.find((f) => f.isHuman);
        if (!human) return false;
        const check = canDeployUnit(human, unitType);
        if (!check.allowed) {
          callbacksRef.current.onStatusToast(check.reason || 'Cannot deploy unit');
          return false;
        }
        const spec = UNIT_SPECS[unitType];
        human.ore -= spec.costOre;
        human.energy -= spec.costEnergy;
        human.supplyUsed += spec.supplyCost;
        const created = spawnUnitEntity(human.slotIndex, unitType);
        if (created && !units.some((u) => u.selected)) {
          created.selected = true;
        }
        if (unitType === 'carrier') {
          soundAndHaptics.playCarrierDeploy();
          callbacksRef.current.onStatusToast('LEVIATHAN TITAN CARRIER WARPED INTO LIVING ROOM!');
        } else {
          soundAndHaptics.playUpgradeOrBuild();
        }
        syncHudImmediate();
        return true;
      },

      buildStructure: (buildingType: BuildingType) => {
        const human = factions.find((f) => f.isHuman);
        if (!human) return false;
        const check = canBuildStructure(human, buildingType);
        if (!check.allowed) {
          callbacksRef.current.onStatusToast(check.reason || 'Requirements not met');
          return false;
        }
        const updated = constructStructure(human, buildingType);
        Object.assign(human, updated);
        soundAndHaptics.playUpgradeOrBuild();
        callbacksRef.current.onStatusToast(
          `${BUILDING_SPECS[buildingType].name} fabricated in orbital slot!`
        );
        syncHudImmediate();
        return true;
      },

      upgradeTier: () => {
        const human = factions.find((f) => f.isHuman);
        if (!human) return false;
        const check = canUpgradeBaseTier(human);
        if (!check.allowed) {
          callbacksRef.current.onStatusToast(check.reason || 'Cannot upgrade Base Tier');
          return false;
        }
        const updated = upgradeBaseTier(human);
        Object.assign(human, updated);
        soundAndHaptics.playCarrierDeploy();
        spawnParticleBurst(
          human.position.x,
          human.position.y,
          human.position.z,
          ARMY_COLORS[human.colorId].num,
          28,
          4.8
        );
        callbacksRef.current.onStatusToast(
          `Space Station upgraded to Tier ${human.baseTier}!`
        );
        syncHudImmediate();
        return true;
      },

      triggerHeroAbility: () => {
        const human = factions.find((f) => f.isHuman);
        if (!human || human.defeated) return false;
        if (human.heroCooldown > 0) {
          callbacksRef.current.onStatusToast(
            `Hero Ability cooling down (${Math.ceil(human.heroCooldown)}s)`
          );
          return false;
        }
        const heroSpec = HERO_COMMANDERS[human.heroId];
        human.heroCooldown = heroSpec.cooldownSec;
        human.heroActiveTimer = 10;
        soundAndHaptics.playCarrierDeploy();

        if (human.heroId === 'valkyrie') {
          spawnUnitEntity(human.slotIndex, 'interceptor');
          spawnUnitEntity(human.slotIndex, 'interceptor');
        } else if (human.heroId === 'aegis') {
          human.baseShield = Math.min(human.maxBaseShield, human.baseShield + 350);
          for (const u of units) {
            if (u.ownerSlot === human.slotIndex && u.koTimer === 0) {
              u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
            }
          }
        } else if (human.heroId === 'hyperion') {
          for (let i = 0; i < 6; i++) {
            spawnUnitEntity(human.slotIndex, 'micro_drone');
          }
        } else if (human.heroId === 'nexus') {
          human.ore += 260;
          human.energy += 150;
        }

        spawnParticleBurst(
          human.position.x,
          human.position.y + 0.5,
          human.position.z,
          0xfef08a,
          26,
          5.0
        );
        callbacksRef.current.onStatusToast(
          `${heroSpec.name}: ${heroSpec.abilityName} Activated!`
        );
        syncHudImmediate();
        return true;
      },

      setStance: (stance: TacticalStance) => {
        const human = factions.find((f) => f.isHuman);
        if (!human) return;
        human.stance = stance;
        soundAndHaptics.playVoiceAck();
        syncHudImmediate();
      },

      selectUnitsByFilter: (filter) => {
        const human = factions.find((f) => f.isHuman);
        if (!human) return;
        let count = 0;
        for (const u of units) {
          if (u.ownerSlot !== human.slotIndex || u.koTimer > 0) {
            u.selected = false;
            continue;
          }
          if (filter === 'clear') {
            u.selected = false;
          } else if (filter === 'all') {
            u.selected = true;
            count++;
          } else if (filter === 'all_combat') {
            u.selected = u.type !== 'miner';
            if (u.selected) count++;
          } else {
            u.selected = u.type === filter;
            if (u.selected) count++;
          }
        }
        soundAndHaptics.playVoiceAck();
        if (filter !== 'clear') {
          callbacksRef.current.onStatusToast(
            count > 0
              ? `Selected ${count} ship(s) — Click map to Move or click Enemy to Attack!`
              : 'No matching ships active in sector'
          );
        }
        syncHudImmediate();
      },

      clearSelectedUnitOrders: () => {
        for (const u of units) {
          if (u.selected) {
            u.manualMoveTarget = null;
            u.manualAttackTargetId = null;
            u.manualStationTargetSlot = null;
            u.manualAsteroidTargetId = null;
            u.orderLabel = 'Autonomous Fleet AI';
          }
        }
        orderMarkerGroup.visible = false;
        soundAndHaptics.playVoiceAck();
        callbacksRef.current.onStatusToast('Selected units returned to Autonomous Fleet AI');
        syncHudImmediate();
      },

      executeVoiceCommand: (intent: VoiceCommandIntent) => {
        const human = factions.find((f) => f.isHuman);
        if (!human) return 'No active commander';
        soundAndHaptics.playVoiceAck();

        switch (intent) {
          case 'ALL_ATTACK':
            human.stance = 'attack';
            rallyPoint = null;
            syncHudImmediate();
            return 'Voice Tactical Order: All Units Full Assault!';
          case 'DEFEND_BASE':
            human.stance = 'defend';
            rallyPoint = { x: human.position.x, z: human.position.z - 2.5 };
            syncHudImmediate();
            return 'Voice Tactical Order: Recall Fleet & Defend Station!';
          case 'FOCUS_CARRIERS':
            human.stance = 'focus_carriers';
            syncHudImmediate();
            return 'Voice Tactical Order: Prioritize Hostile Carriers & Cruisers!';
          case 'HARVEST_BOOST':
            human.stance = 'harvest';
            apiRef.current?.deployUnit('miner');
            syncHudImmediate();
            return 'Voice Tactical Order: Maximize Asteroid Ore Extraction!';
          case 'DEPLOY_CARRIER': {
            const ok = apiRef.current?.deployUnit('carrier');
            return ok
              ? 'Voice Tactical Order: Deploying Leviathan Titan Carrier!'
              : 'Voice Order: Titan Carrier requires Tier 3 & Carrier Foundry!';
          }
          case 'HERO_ABILITY':
            apiRef.current?.triggerHeroAbility();
            return 'Voice Tactical Order: Commander Hero Overdrive Engaged!';
          case 'PASSTHROUGH_CALIBRATE':
            callbacksRef.current.onTogglePassthrough();
            return 'Voice Tactical Order: Living Room Passthrough Calibrated!';
        }
      },

      executeWristWatchAction: (action: WristWatchActionId) => {
        handleWatchAction(action);
      },

      setRoomVantage: (vantage: RoomVantageAngle) => {
        setRoomVantageCamera(vantage);
      },

      setFloatingLevelConfig: (patch: Partial<WristWatchPanelState>) => {
        Object.assign(wristWatchState, patch);
        applyFloatingArenaTransform();
        syncHudImmediate();
      },

      startWebXRPassthrough: async () => {
        const navXR = (navigator as unknown as { xr?: XRSystem }).xr;

        // 1. If WebXR headset support was detected on mount (e.g. Meta Quest 3 Browser),
        // MUST invoke requestSession synchronously inside the user gesture BEFORE any await!
        if (navXR && (xrSupportCache.ar || xrSupportCache.vr)) {
          try {
            const xrFeatures = ['local-floor', 'bounded-floor', 'hand-tracking'];
            const targetMode = xrSupportCache.ar ? 'immersive-ar' : 'immersive-vr';
            const session = await navXR.requestSession(targetMode, {
              optionalFeatures: xrFeatures,
            });
            renderer.setClearColor(0x000000, 0);
            renderer.xr.setReferenceSpaceType('local-floor');
            await renderer.xr.setSession(session);
            soundAndHaptics.setXRSession(session);
            callbacksRef.current.onImmersiveModeChange(true);
            applyFloatingArenaTransform();

            // Read Quest 3 Guardian Room Boundary Polygon if bounded-floor is granted
            session
              .requestReferenceSpace('bounded-floor')
              .then((refSpace) => {
                const bounded = refSpace as XRBoundedReferenceSpace;
                if (bounded.boundsGeometry && bounded.boundsGeometry.length >= 3) {
                  const scaledPts = bounded.boundsGeometry.map((pt) => ({
                    x: pt.x * 10,
                    z: pt.z * 10,
                  }));
                  livingRoom.updateGuardianPolygon(scaledPts);
                }
              })
              .catch(() => {});

            session.addEventListener('end', () => {
              soundAndHaptics.setXRSession(null);
              callbacksRef.current.onImmersiveModeChange(false);
              applyFloatingArenaTransform();
            });
            callbacksRef.current.onStatusToast(
              'Quest 3 Full Immersive XR Active — Walk Around Your Living Room!'
            );
            return true;
          } catch {
            // Fall through to Fullscreen First-Person 3D Immersive Mode below
          }
        }

        // 2. Fullscreen First-Person 3D Immersive Room-Walk Mode (hides 2D browser UI & puts 3D Hands + 3D Wristwatch front & center!)
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
        if (!passthroughRef.current) {
          callbacksRef.current.onTogglePassthrough();
        }
        wristWatchState.open = true;
        setRoomVantageCamera('center_walk');
        callbacksRef.current.onImmersiveModeChange(true);
        callbacksRef.current.onStatusToast(
          'Full Immersive 3D Mode Active — Walk with WASD & Command via 3D Left Wristwatch!'
        );
        syncHudImmediate();
        return true;
      },

      exitFullImmersiveMode: () => {
        const currentSession = renderer.xr.getSession();
        if (currentSession) {
          currentSession.end().catch(() => {});
        }
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        callbacksRef.current.onImmersiveModeChange(false);
        setRoomVantageCamera('south_sofa');
        callbacksRef.current.onStatusToast('Exited Full Immersive Mode — Returned to Tactical Command View');
        syncHudImmediate();
      },

      resetMatch: (slots: PlayerSlotConfig[]) => {
        initializeMatch(slots);
      },
    };

    initializeMatch(playerSlots);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Unified 3D Raycast Handler: Checks 3D Wristwatch Panel FIRST, then Floating Battle Plane
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const tryIntersect3DWristWatch = (): boolean => {
      const hits = raycaster.intersectObjects(leftHandRig.interactiveMeshes, false);
      if (hits.length > 0) {
        const action = hits[0].object.userData.watchAction as WristWatchActionId | undefined;
        if (action) {
          handleWatchAction(action);
          return true;
        }
      }
      return false;
    };

    const getArenaPointFromRay = (): { x: number; z: number } | null => {
      const hit = raycaster.ray.intersectPlane(_rayPlane, _scratchVecA);
      if (hit) {
        const xrFactor = renderer.xr.isPresenting ? 0.095 : 1.0;
        const effScale = xrFactor * wristWatchState.roomBoundaryScale;
        const mapped = mapRoomWorldToArenaCoords(hit.x, hit.z, effScale);
        reticleGroup.position.set(mapped.x, 1.15, mapped.z);
        return mapped;
      }
      return null;
    };

    const getWorldPointFromScreen = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      return getArenaPointFromRay();
    };

    const handleSpatialPointInteraction = (
      worldX: number,
      worldZ: number,
      isShiftKey: boolean,
      isExplicitOrderButton: boolean
    ) => {
      const human = factions.find((f) => f.isHuman);
      if (!human || human.defeated) return;
      pointerPinchActiveTimer = 0.22;

      // 1. Check if pointer/VR ray hit a Friendly Unit (unless right-clicking for an explicit move order)
      if (!isExplicitOrderButton) {
        let clickedFriendly: UnitEntity | null = null;
        let bestFriendlyDist = 1.55;
        for (const u of units) {
          if (u.ownerSlot === human.slotIndex && u.koTimer === 0) {
            const d = Math.hypot(u.x - worldX, u.z - worldZ);
            if (d < bestFriendlyDist) {
              bestFriendlyDist = d;
              clickedFriendly = u;
            }
          }
        }

        if (clickedFriendly) {
          if (!isShiftKey) {
            for (const u of units) {
              if (u.ownerSlot === human.slotIndex) u.selected = false;
            }
          }
          clickedFriendly.selected = !clickedFriendly.selected || !isShiftKey;
          soundAndHaptics.playVoiceAck();
          callbacksRef.current.onStatusToast(
            `Selected ${UNIT_SPECS[clickedFriendly.type].name} — Click map to Move or click Enemy to Attack!`
          );
          syncHudImmediate();
          return;
        }
      }

      const anySelected = units.some(
        (u) => u.ownerSlot === human.slotIndex && u.selected && u.koTimer === 0
      );

      // 2. If units are selected, check if player clicked an Enemy Ship to Attack!
      if (anySelected) {
        let clickedEnemy: UnitEntity | null = null;
        let bestEnemyDist = 1.75;
        for (const u of units) {
          if (u.team !== human.team && u.koTimer === 0) {
            const d = Math.hypot(u.x - worldX, u.z - worldZ);
            if (d < bestEnemyDist) {
              bestEnemyDist = d;
              clickedEnemy = u;
            }
          }
        }

        if (clickedEnemy) {
          const count = issueTargetOrderToUnits(units, {
            enemyUnitId: clickedEnemy.id,
            enemyUnitName: UNIT_SPECS[clickedEnemy.type].name,
          });
          orderMarkerMat.color.setHex(0xf43f5e);
          orderMarkerGroup.position.set(clickedEnemy.x, 1.15, clickedEnemy.z);
          orderMarkerGroup.visible = true;
          soundAndHaptics.playLaserPew(true);
          callbacksRef.current.onStatusToast(
            `Target Locked: ${count} ship(s) attacking hostile ${UNIT_SPECS[clickedEnemy.type].name}!`
          );
          syncHudImmediate();
          return;
        }

        // 3. Check if player clicked an Enemy Base Station to Siege
        for (const ef of factions) {
          if (ef.team !== human.team && !ef.defeated) {
            const d = Math.hypot(ef.position.x - worldX, ef.position.z - worldZ);
            if (d < 2.8) {
              const count = issueTargetOrderToUnits(units, {
                enemyStationSlot: ef.slotIndex,
                enemyStationName: ef.name,
              });
              orderMarkerMat.color.setHex(0xf43f5e);
              orderMarkerGroup.position.set(ef.position.x, 1.15, ef.position.z);
              orderMarkerGroup.visible = true;
              soundAndHaptics.playLaserPew(true);
              callbacksRef.current.onStatusToast(
                `Siege Order: ${count} ship(s) attacking ${ef.name}!`
              );
              syncHudImmediate();
              return;
            }
          }
        }

        // 4. Check if player clicked an Ore Asteroid (while a Miner is selected)
        const hasSelectedMiner = units.some(
          (u) => u.ownerSlot === human.slotIndex && u.selected && u.type === 'miner'
        );
        if (hasSelectedMiner) {
          for (const ast of asteroids) {
            if (Math.hypot(ast.x - worldX, ast.z - worldZ) < 1.65) {
              issueTargetOrderToUnits(units, { asteroidId: ast.id });
              orderMarkerMat.color.setHex(0x38bdf8);
              orderMarkerGroup.position.set(ast.x, 1.15, ast.z);
              orderMarkerGroup.visible = true;
              soundAndHaptics.playVoiceAck();
              callbacksRef.current.onStatusToast('Miner Drone assigned to target Ore Asteroid!');
              syncHudImmediate();
              return;
            }
          }
        }

        // 5. Otherwise, issue a Tactical Move Order to the clicked map coordinate!
        const movedCount = issueMoveOrderToUnits(units, worldX, worldZ);
        orderMarkerMat.color.setHex(0x34d399);
        orderMarkerGroup.position.set(worldX, 1.15, worldZ);
        orderMarkerGroup.visible = true;
        soundAndHaptics.playVoiceAck();
        spawnParticleBurst(worldX, 1.15, worldZ, 0x34d399, 6, 1.8);
        callbacksRef.current.onStatusToast(
          `Move Order: ${movedCount} ship(s) advancing to (${Math.round(worldX)}, ${Math.round(worldZ)})`
        );
        syncHudImmediate();
        return;
      }

      // 6. If no unit was selected and player clicked empty space, set fleet rally point & fire Virtual Hand Pulse
      rallyPoint = { x: worldX, z: worldZ };
      const teamColor = ARMY_COLORS[human.colorId]?.num ?? 0x06b6d4;
      lasers.push({
        id: `las_ctrl_${Date.now()}_${Math.random()}`,
        fromX: rightHandRig.group.position.x,
        fromY: rightHandRig.group.position.y,
        fromZ: rightHandRig.group.position.z,
        toX: worldX,
        toY: 1.15,
        toZ: worldZ,
        colorHex: teamColor,
        width: 2,
        ttl: 0.22,
        maxTtl: 0.22,
      });
      soundAndHaptics.playLaserPew(false);
      spawnParticleBurst(worldX, 1.15, worldZ, teamColor, 6, 1.8);
    };

    const onPointerMove = (e: PointerEvent) => {
      getWorldPointFromScreen(e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      const dragDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dragDist > 7) return;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      // 1. Check if user clicked on the 3D Wristwatch Bezel or Floating Wristwatch Hologram Panel
      if (tryIntersect3DWristWatch()) {
        return;
      }

      // 2. Otherwise interact with the Floating Living Room Battle Plane
      const worldPt = getArenaPointFromRay();
      if (!worldPt) return;
      handleSpatialPointInteraction(worldPt.x, worldPt.z, e.shiftKey, e.button === 2);
    };

    // WebXR Hand Controller & Hand-Tracking Trigger (`selectstart`) support for Quest 3
    const xrCtrl0 = renderer.xr.getController(0);
    const xrCtrl1 = renderer.xr.getController(1);
    const onXRControllerSelect = (ctrl: THREE.XRTargetRaySpace) => {
      if (gameStateRef.current !== 'playing') return;
      _scratchMat4.identity().extractRotation(ctrl.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_scratchMat4);

      if (tryIntersect3DWristWatch()) {
        return;
      }

      const pt = getArenaPointFromRay();
      if (pt) {
        handleSpatialPointInteraction(pt.x, pt.z, false, false);
      }
    };
    xrCtrl0.addEventListener('selectstart', () => onXRControllerSelect(xrCtrl0));
    xrCtrl1.addEventListener('selectstart', () => onXRControllerSelect(xrCtrl1));
    scene.add(xrCtrl0, xrCtrl1);

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // WASD / Arrow Key Room Walk-Around + Wristwatch Toggle [V] + Room Vantage Cycle [C]
    const vantageOrder: RoomVantageAngle[] = [
      'south_sofa',
      'east_credenza',
      'north_tv',
      'west_shelf',
      'center_walk',
      'overhead',
    ];
    const keysHeld = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      keysHeld.add(e.code);
      if (gameStateRef.current === 'playing') {
        if (e.code === 'KeyV') {
          handleWatchAction('TOGGLE_PANEL');
          return;
        }
        if (e.code === 'KeyC') {
          const idx = vantageOrder.indexOf(wristWatchState.activeVantage);
          const nextVantage = vantageOrder[(idx + 1) % vantageOrder.length];
          setRoomVantageCamera(nextVantage);
          return;
        }
        if (e.code === 'KeyQ') apiRef.current?.deployUnit('miner');
        if (e.code === 'KeyW' && e.shiftKey) apiRef.current?.deployUnit('interceptor');
        if (e.code === 'KeyE') apiRef.current?.deployUnit('frigate');
        if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) apiRef.current?.deployUnit('cruiser');
        if (e.code === 'KeyT') apiRef.current?.deployUnit('carrier');
        if (e.code === 'KeyY') apiRef.current?.deployUnit('hero_flagship');
        if (e.code === 'Space') {
          e.preventDefault();
          apiRef.current?.triggerHeroAbility();
        }
        if (e.code === 'Digit1') apiRef.current?.buildStructure('refinery');
        if (e.code === 'Digit2') apiRef.current?.buildStructure('sensor_array');
        if (e.code === 'Digit3') apiRef.current?.buildStructure('orbital_shipyard');
        if (e.code === 'Digit4') apiRef.current?.buildStructure('defense_grid');
        if (e.code === 'Digit5') apiRef.current?.buildStructure('titan_foundry');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysHeld.delete(e.code);
    };
    const onWindowBlur = () => {
      keysHeld.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    // Simulation Step
    const advanceSimulation = (rawDt: number) => {
      const dt = Math.min(rawDt, 0.05);

      livingRoom.setBlendMode(furnitureBlendRef.current, passthroughRef.current);
      if (passthroughRef.current) {
        scene.background = null;
        scene.fog = null;
      } else {
        if (!scene.background) {
          scene.background = new THREE.Color(0x040812);
        }
        if (!scene.fog) {
          scene.fog = new THREE.FogExp2(0x040812, 0.012);
        }
      }

      if (pointerPinchActiveTimer > 0) {
        pointerPinchActiveTimer = Math.max(0, pointerPinchActiveTimer - dt);
      }

      if (gameStateRef.current === 'title') {
        matchElapsedSec += dt;
        const tourAngle = matchElapsedSec * 0.16;
        camera.position.x = Math.sin(tourAngle) * 25.0;
        camera.position.z = Math.cos(tourAngle) * 25.0;
        camera.position.y = 16.5 + Math.sin(matchElapsedSec * 0.4) * 1.5;
        camera.lookAt(0, 1.8, 0);
        leftHandRig.group.visible = false;
        rightHandRig.group.visible = false;
      } else if (gameStateRef.current === 'playing') {
        leftHandRig.group.visible = true;
        rightHandRig.group.visible = true;

        // Smooth camera glide when switching Room Walk-Around Vantages (South / East / North / West / Eye-Level)
        if (cameraTransitionTarget) {
          cameraTransitionTarget.timer -= dt;
          camera.position.lerp(cameraTransitionTarget.camPos, Math.min(1, dt * 6.5));
          controls.target.lerp(cameraTransitionTarget.lookTarget, Math.min(1, dt * 6.5));
          if (cameraTransitionTarget.timer <= 0) {
            cameraTransitionTarget = null;
          }
        }

        // Physical Room Walk-Around Controls (WASD / Arrows move along camera view direction around the room!)
        const walkSpeed = 15.0 * dt;
        camera.getWorldDirection(_scratchForward);
        _scratchForward.y = 0;
        if (_scratchForward.lengthSq() > 0.001) _scratchForward.normalize();
        _scratchRight.crossVectors(_scratchForward, _scratchUp.set(0, 1, 0)).normalize();

        if (keysHeld.has('ArrowUp') || (keysHeld.has('KeyW') && !keysHeld.has('ShiftLeft'))) {
          camera.position.addScaledVector(_scratchForward, walkSpeed);
          controls.target.addScaledVector(_scratchForward, walkSpeed);
        }
        if (keysHeld.has('ArrowDown') || keysHeld.has('KeyS')) {
          camera.position.addScaledVector(_scratchForward, -walkSpeed);
          controls.target.addScaledVector(_scratchForward, -walkSpeed);
        }
        if (keysHeld.has('ArrowLeft') || keysHeld.has('KeyA')) {
          camera.position.addScaledVector(_scratchRight, -walkSpeed);
          controls.target.addScaledVector(_scratchRight, -walkSpeed);
        }
        if (keysHeld.has('ArrowRight') || keysHeld.has('KeyD')) {
          camera.position.addScaledVector(_scratchRight, walkSpeed);
          controls.target.addScaledVector(_scratchRight, walkSpeed);
        }
        controls.update();

        // Position Virtual Hands & Left-Wrist Watch Panel
        if (renderer.xr.isPresenting) {
          leftHandRig.group.scale.setScalar(0.18);
          rightHandRig.group.scale.setScalar(0.18);
          if (!wristWatchState.pinnedInRoom) {
            leftHandRig.group.position.setFromMatrixPosition(xrCtrl0.matrixWorld);
            leftHandRig.group.quaternion.setFromRotationMatrix(xrCtrl0.matrixWorld);
          }
          rightHandRig.group.position.setFromMatrixPosition(xrCtrl1.matrixWorld);
          rightHandRig.group.quaternion.setFromRotationMatrix(xrCtrl1.matrixWorld);
        } else {
          // In Room-Walk / Full Immersive 3D mode, anchor virtual hands naturally in front of the player's view
          const isImmersive3D = immersiveModeRef.current;
          leftHandRig.group.scale.setScalar(isImmersive3D ? 1.12 : 0.95);
          rightHandRig.group.scale.setScalar(isImmersive3D ? 1.08 : 0.95);
          camera.getWorldDirection(_scratchForward);
          _scratchRight.crossVectors(_scratchForward, _scratchUp.set(0, 1, 0)).normalize();
          const camUp = _scratchVecB.crossVectors(_scratchRight, _scratchForward).normalize();

          if (!wristWatchState.pinnedInRoom) {
            leftHandRig.group.position
              .copy(camera.position)
              .addScaledVector(_scratchForward, isImmersive3D ? 5.3 : 6.8)
              .addScaledVector(_scratchRight, isImmersive3D ? -1.75 : -2.75)
              .addScaledVector(camUp, isImmersive3D ? -0.68 : -1.15);
            leftHandRig.group.quaternion.copy(camera.quaternion);
          }

          rightHandRig.group.position
            .copy(camera.position)
            .addScaledVector(_scratchForward, isImmersive3D ? 5.4 : 6.8)
            .addScaledVector(_scratchRight, isImmersive3D ? 1.95 : 2.85)
            .addScaledVector(camUp, isImmersive3D ? -0.82 : -1.25);
          rightHandRig.group.lookAt(
            reticleGroup.position.x,
            wristWatchState.battleElevationY,
            reticleGroup.position.z
          );
        }

        leftHandRig.animatePose(matchElapsedSec, pointerPinchActiveTimer > 0);
        rightHandRig.animatePose(matchElapsedSec, pointerPinchActiveTimer > 0);
      }

      if (gameStateRef.current === 'paused' || gameStateRef.current === 'gameover') {
        return;
      }

      if (hitstopTimer > 0) {
        hitstopTimer = Math.max(0, hitstopTimer - dt);
        return;
      }

      matchElapsedSec += dt;

      // 1. Update Factions
      for (const f of factions) {
        if (f.defeated) continue;

        const diffMult = f.isHuman
          ? 1.0
          : AI_DIFFICULTY_MULTIPLIERS[f.difficulty].resourceRateMult;
        const hasRefinery = f.buildings.includes('refinery');
        const hasSensor = f.buildings.includes('sensor_array');
        const isNexus = f.heroId === 'nexus';
        const isAegis = f.heroId === 'aegis';

        const oreRate = (6 + (hasRefinery ? 5 : 0)) * diffMult;
        const energyRate = (5 + (hasSensor ? 6 : 0) + (isNexus ? 5 : 0)) * diffMult;

        f.ore += oreRate * dt;
        f.energy += energyRate * dt;

        const shieldRegen = (isAegis ? 9 : 6) * dt;
        f.baseShield = Math.min(f.maxBaseShield, f.baseShield + shieldRegen);

        if (f.heroCooldown > 0) f.heroCooldown = Math.max(0, f.heroCooldown - dt);
        if (f.heroActiveTimer > 0) f.heroActiveTimer = Math.max(0, f.heroActiveTimer - dt);

        // Station & Defense Grid Autonomous Point-Defense Turrets
        const turretRange = f.buildings.includes('defense_grid') ? 11.5 : 7.5;
        if (Math.random() < dt * (f.buildings.includes('defense_grid') ? 3.2 : 1.4)) {
          let nearestEnemy: UnitEntity | null = null;
          let minD2 = turretRange * turretRange;
          for (const u of units) {
            if (u.team !== f.team && u.koTimer === 0) {
              const dx = u.x - f.position.x;
              const dz = u.z - f.position.z;
              const d2 = dx * dx + dz * dz;
              if (d2 < minD2) {
                minD2 = d2;
                nearestEnemy = u;
              }
            }
          }
          if (nearestEnemy) {
            const dmg = f.buildings.includes('defense_grid') ? 26 : 14;
            nearestEnemy.hp -= dmg;
            nearestEnemy.hitFlashTimer = 0.07;
            lasers.push({
              id: `st_las_${Date.now()}_${Math.random()}`,
              fromX: f.position.x,
              fromY: f.position.y + 0.65,
              fromZ: f.position.z,
              toX: nearestEnemy.x,
              toY: nearestEnemy.y,
              toZ: nearestEnemy.z,
              colorHex: ARMY_COLORS[f.colorId].num,
              width: 2,
              ttl: 0.16,
              maxTtl: 0.16,
            });
          }
        }

        // AI Commander Decision Loop
        if (!f.isHuman && gameStateRef.current === 'playing') {
          f.aiActionTimer -= dt;
          if (f.aiActionTimer <= 0) {
            const aiSpec = AI_DIFFICULTY_MULTIPLIERS[f.difficulty];
            f.aiActionTimer = aiSpec.decisionIntervalSec;

            if (canUpgradeBaseTier(f).allowed) {
              Object.assign(f, upgradeBaseTier(f));
            } else if (!f.buildings.includes('refinery') && canBuildStructure(f, 'refinery').allowed) {
              Object.assign(f, constructStructure(f, 'refinery'));
            } else if (!f.buildings.includes('sensor_array') && canBuildStructure(f, 'sensor_array').allowed) {
              Object.assign(f, constructStructure(f, 'sensor_array'));
            } else if (
              f.baseTier >= 2 &&
              !f.buildings.includes('orbital_shipyard') &&
              canBuildStructure(f, 'orbital_shipyard').allowed
            ) {
              Object.assign(f, constructStructure(f, 'orbital_shipyard'));
            } else if (
              f.baseTier >= 2 &&
              !f.buildings.includes('defense_grid') &&
              canBuildStructure(f, 'defense_grid').allowed
            ) {
              Object.assign(f, constructStructure(f, 'defense_grid'));
            } else if (
              f.baseTier >= 3 &&
              !f.buildings.includes('titan_foundry') &&
              canBuildStructure(f, 'titan_foundry').allowed
            ) {
              Object.assign(f, constructStructure(f, 'titan_foundry'));
            }

            const aiUnits = units.filter((u) => u.ownerSlot === f.slotIndex && u.koTimer === 0);
            const aiMiners = aiUnits.filter((u) => u.type === 'miner').length;
            f.supplyUsed = aiUnits.reduce((acc, u) => acc + UNIT_SPECS[u.type].supplyCost, 0);

            if (aiMiners < 3 && canDeployUnit(f, 'miner').allowed) {
              f.ore -= UNIT_SPECS.miner.costOre;
              f.energy -= UNIT_SPECS.miner.costEnergy;
              spawnUnitEntity(f.slotIndex, 'miner');
            } else if (canDeployUnit(f, 'carrier').allowed) {
              f.ore -= UNIT_SPECS.carrier.costOre;
              f.energy -= UNIT_SPECS.carrier.costEnergy;
              spawnUnitEntity(f.slotIndex, 'carrier');
              soundAndHaptics.playCarrierDeploy();
              callbacksRef.current.onStatusToast(
                `WARNING: ${f.name} deployed a Leviathan Titan Carrier!`
              );
            } else if (Math.random() < 0.45 && canDeployUnit(f, 'cruiser').allowed) {
              f.ore -= UNIT_SPECS.cruiser.costOre;
              f.energy -= UNIT_SPECS.cruiser.costEnergy;
              spawnUnitEntity(f.slotIndex, 'cruiser');
            } else if (Math.random() < 0.65 && canDeployUnit(f, 'frigate').allowed) {
              f.ore -= UNIT_SPECS.frigate.costOre;
              f.energy -= UNIT_SPECS.frigate.costEnergy;
              spawnUnitEntity(f.slotIndex, 'frigate');
            } else if (canDeployUnit(f, 'interceptor').allowed) {
              f.ore -= UNIT_SPECS.interceptor.costOre;
              f.energy -= UNIT_SPECS.interceptor.costEnergy;
              spawnUnitEntity(f.slotIndex, 'interceptor');
            }
          }
        }

        const stMesh = stationMeshes.get(f.slotIndex);
        if (stMesh) {
          syncStationVisuals(
            stMesh,
            f.baseTier,
            f.buildings,
            ARMY_COLORS[f.colorId].num,
            matchElapsedSec
          );
        }
      }

      // 2. Rotate 20 Glowing Asteroids
      for (const ast of asteroids) {
        const mesh = asteroidMeshes.get(ast.id);
        if (mesh) {
          mesh.rotation.y += ast.rotationSpeed * dt;
          mesh.rotation.x += ast.rotationSpeed * 0.5 * dt;
          const ratio = Math.max(0.3, ast.oreRemaining / ast.maxOre);
          mesh.scale.setScalar(ratio);
        }
      }

      // 3. Rebuild Tactical Order Trajectory Lines for Selected Units
      orderLinesRoot.clear();

      // 4. Update All Fleet Units (Dramatic Slower Movement, Direct Orders & Combat)
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        const mesh = unitMeshes.get(u.id);
        const owner = factions.find((f) => f.slotIndex === u.ownerSlot);
        if (!owner) continue;

        if (u.hp <= 0 && u.koTimer === 0) {
          u.koTimer = 0.45;
          u.selected = false;
          const colorHex = ARMY_COLORS[owner.colorId].num;
          const isCarrier = u.type === 'carrier';
          const isMedium = u.type === 'cruiser' || u.type === 'frigate' || u.type === 'hero_flagship';
          soundAndHaptics.playExplosion(
            isCarrier ? 'carrier' : isMedium ? 'medium' : 'light'
          );
          spawnParticleBurst(
            u.x,
            u.y,
            u.z,
            colorHex,
            isCarrier ? 28 : isMedium ? 16 : 9,
            isCarrier ? 5.2 : 3.2
          );
          if (isCarrier) {
            hitstopTimer = 0.06;
            cameraShakeTrauma = Math.min(1.0, cameraShakeTrauma + 0.55);
          } else if (isMedium) {
            cameraShakeTrauma = Math.min(1.0, cameraShakeTrauma + 0.22);
          }
        }

        if (u.koTimer > 0) {
          u.koTimer -= dt;
          if (mesh) {
            mesh.rotation.z += 4.2 * dt;
            mesh.rotation.x += 2.6 * dt;
            mesh.position.y -= 0.7 * dt;
            mesh.scale.multiplyScalar(Math.max(0.1, 1 - dt * 2.1));
          }
          if (u.koTimer <= 0) {
            if (mesh) {
              unitsRoot.remove(mesh);
              unitMeshes.delete(u.id);
            }
            units.splice(i, 1);
          }
          continue;
        }

        const spec = UNIT_SPECS[u.type];
        const heroSpeedMult = owner.heroActiveTimer > 0 && owner.heroId === 'valkyrie' ? 1.5 : 1.0;
        const speed = spec.speed * heroSpeedMult;

        // Policy 1: HARVESTER (Astro Miner Drone — prioritizes its own station's 5 asteroids or manual order)
        if (u.policy === 'harvester') {
          if (u.manualMoveTarget) {
            const dx = u.manualMoveTarget.x - u.x;
            const dz = u.manualMoveTarget.z - u.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.65) {
              u.vx = (dx / dist) * speed;
              u.vz = (dz / dist) * speed;
              u.x += u.vx * dt;
              u.z += u.vz * dt;
              u.rotationY = Math.atan2(u.vx, u.vz);
            } else {
              u.manualMoveTarget = null;
              u.orderLabel = 'Mining Station Asteroids';
            }
          } else {
            let bestAst: AsteroidEntity | null = null;
            if (u.manualAsteroidTargetId) {
              bestAst =
                asteroids.find((a) => a.id === u.manualAsteroidTargetId && a.oreRemaining > 0) ??
                null;
            }
            if (!bestAst) {
              let minScore = Infinity;
              for (const ast of asteroids) {
                if (ast.oreRemaining <= 0) continue;
                const d = Math.hypot(ast.x - u.x, ast.z - u.z);
                // Prefer the 5 asteroids assigned to this miner's home station
                const stationBias = ast.stationSlot === u.ownerSlot ? 0.35 : 1.5;
                const score = d * stationBias;
                if (score < minScore) {
                  minScore = score;
                  bestAst = ast;
                }
              }
            }

            if (bestAst) {
              const dx = bestAst.x - u.x;
              const dz = bestAst.z - u.z;
              const dist = Math.hypot(dx, dz);
              if (dist > 1.45) {
                u.vx = (dx / dist) * speed;
                u.vz = (dz / dist) * speed;
                u.x += u.vx * dt;
                u.z += u.vz * dt;
                u.rotationY = Math.atan2(u.vx, u.vz);
              } else {
                const orbitAngle = matchElapsedSec * 0.65 + i;
                u.x = THREE.MathUtils.damp(u.x, bestAst.x + Math.cos(orbitAngle) * 1.2, 3, dt);
                u.z = THREE.MathUtils.damp(u.z, bestAst.z + Math.sin(orbitAngle) * 1.2, 3, dt);
                u.rotationY = Math.atan2(bestAst.x - u.x, bestAst.z - u.z);

                u.attackCooldown -= dt;
                if (u.attackCooldown <= 0) {
                  u.attackCooldown = spec.fireRateSec;
                  const yieldMult =
                    (owner.buildings.includes('refinery') ? 1.35 : 1.0) *
                    (owner.heroId === 'nexus' ? 1.3 : 1.0);
                  const mined = Math.min(bestAst.oreRemaining, 7.5 * yieldMult);
                  bestAst.oreRemaining = Math.max(120, bestAst.oreRemaining - mined * 0.2);
                  owner.ore += mined;
                  owner.energy += mined * 0.32;
                  owner.oreMinedTotal += mined;

                  lasers.push({
                    id: `mine_${u.id}_${Date.now()}`,
                    fromX: u.x,
                    fromY: u.y,
                    fromZ: u.z,
                    toX: bestAst.x,
                    toY: bestAst.y,
                    toZ: bestAst.z,
                    colorHex: 0x38bdf8,
                    width: 1.5,
                    ttl: 0.26,
                    maxTtl: 0.26,
                    isMining: true,
                  });
                }
              }
            }
          }
        } else {
          // Combat Units
          if (u.policy === 'carrier_boss' && gameStateRef.current === 'playing') {
            u.carrierSpawnTimer -= dt;
            if (u.carrierSpawnTimer <= 0) {
              u.carrierSpawnTimer = 5.2;
              const activeMicroCount = units.filter(
                (m) => m.ownerSlot === u.ownerSlot && m.type === 'micro_drone' && m.koTimer === 0
              ).length;
              const maxSwarm = owner.heroId === 'hyperion' ? 14 : 10;
              if (activeMicroCount < maxSwarm) {
                const spawnBatch = owner.heroId === 'hyperion' ? 3 : 2;
                for (let b = 0; b < spawnBatch; b++) {
                  spawnUnitEntity(u.ownerSlot, 'micro_drone', { x: u.x, z: u.z });
                }
                soundAndHaptics.playLaserPew(false);
              }
            }
          }

          // Check explicit manual attack targets first
          let targetUnit: UnitEntity | null = null;
          let targetStation: FactionState | null = null;

          if (u.manualAttackTargetId) {
            const explicitEnemy = units.find(
              (other) => other.id === u.manualAttackTargetId && other.koTimer === 0
            );
            if (explicitEnemy) {
              targetUnit = explicitEnemy;
            } else {
              u.manualAttackTargetId = null;
              u.orderLabel = 'Autonomous Fleet AI';
            }
          }

          if (typeof u.manualStationTargetSlot === 'number') {
            const explicitSt = factions.find(
              (f) => f.slotIndex === u.manualStationTargetSlot && !f.defeated
            );
            if (explicitSt) {
              targetStation = explicitSt;
            } else {
              u.manualStationTargetSlot = null;
              u.orderLabel = 'Autonomous Fleet AI';
            }
          }

          // If no manual attack target, find nearest priority hostile unit or station
          let bestScore = Infinity;
          if (!targetUnit && !targetStation) {
            for (const other of units) {
              if (other.team === u.team || other.koTimer > 0) continue;
              const dx = other.x - u.x;
              const dz = other.z - u.z;
              let dist = Math.hypot(dx, dz);
              if (
                owner.stance === 'focus_carriers' &&
                (other.type === 'carrier' || other.type === 'cruiser' || other.type === 'hero_flagship')
              ) {
                dist *= 0.35;
              }
              if (dist < bestScore) {
                bestScore = dist;
                targetUnit = other;
              }
            }

            for (const enemyFac of factions) {
              if (enemyFac.team === u.team || enemyFac.defeated) continue;
              const dx = enemyFac.position.x - u.x;
              const dz = enemyFac.position.z - u.z;
              const dist = Math.hypot(dx, dz);
              if (!targetUnit || dist < bestScore * 0.85) {
                bestScore = dist;
                targetStation = enemyFac;
              }
            }
          }

          const targetX = targetUnit ? targetUnit.x : targetStation ? targetStation.position.x : 0;
          const targetZ = targetUnit ? targetUnit.z : targetStation ? targetStation.position.z : 0;
          const distToTarget = Math.hypot(targetX - u.x, targetZ - u.z);

          // Determine Movement Goal: Explicit Manual Move Target takes top movement priority
          let goalX = targetX;
          let goalZ = targetZ;

          if (u.manualMoveTarget) {
            goalX = u.manualMoveTarget.x;
            goalZ = u.manualMoveTarget.z;
            if (Math.hypot(goalX - u.x, goalZ - u.z) < 0.75) {
              u.manualMoveTarget = null;
              u.orderLabel = 'Holding Sector Position';
            }
          } else if (u.manualAttackTargetId || typeof u.manualStationTargetSlot === 'number') {
            // Advance to optimal weapon standoff range of manual target
            if (distToTarget > spec.range * 0.82) {
              goalX = targetX;
              goalZ = targetZ;
            } else {
              goalX = u.x + Math.cos(matchElapsedSec * 0.45 + i) * 0.6;
              goalZ = u.z + Math.sin(matchElapsedSec * 0.45 + i) * 0.6;
            }
          } else if (owner.isHuman && owner.stance === 'defend') {
            const defX = rallyPoint ? rallyPoint.x : owner.position.x;
            const defZ = rallyPoint ? rallyPoint.z : owner.position.z - 2.6;
            goalX = defX + Math.cos(matchElapsedSec * 0.6 + i) * 2.2;
            goalZ = defZ + Math.sin(matchElapsedSec * 0.6 + i) * 2.2;
          } else if (u.policy === 'swarmer' || u.policy === 'orbiter') {
            const strafeAngle = matchElapsedSec * 0.95 + i * 1.3;
            const orbitRadius = u.policy === 'orbiter' ? 2.1 : 3.0;
            goalX = targetX + Math.cos(strafeAngle) * orbitRadius;
            goalZ = targetZ + Math.sin(strafeAngle) * orbitRadius;
          } else if (u.policy === 'kiter') {
            const desiredRange = spec.range * 0.78;
            if (distToTarget < desiredRange * 0.65 && distToTarget > 0.01) {
              goalX = u.x - ((targetX - u.x) / distToTarget) * 2.5;
              goalZ = u.z - ((targetZ - u.z) / distToTarget) * 2.5;
            } else {
              goalX = targetX;
              goalZ = targetZ;
            }
          } else if (u.policy === 'carrier_boss') {
            if (distToTarget > spec.range * 0.75) {
              goalX = targetX;
              goalZ = targetZ;
            } else {
              goalX = u.x + Math.cos(matchElapsedSec * 0.25 + i) * 0.8;
              goalZ = u.z + Math.sin(matchElapsedSec * 0.25 + i) * 0.8;
            }
          }

          const moveDx = goalX - u.x;
          const moveDz = goalZ - u.z;
          const moveDist = Math.hypot(moveDx, moveDz);
          if (moveDist > 0.25) {
            u.vx = (moveDx / moveDist) * speed;
            u.vz = (moveDz / moveDist) * speed;
            u.x = THREE.MathUtils.clamp(u.x + u.vx * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
            u.z = THREE.MathUtils.clamp(u.z + u.vz * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
          }

          const aimX = distToTarget <= spec.range * 1.15 ? targetX - u.x : u.vx;
          const aimZ = distToTarget <= spec.range * 1.15 ? targetZ - u.z : u.vz;
          if (Math.abs(aimX) + Math.abs(aimZ) > 0.01) {
            const targetRot = Math.atan2(aimX, aimZ);
            u.rotationY = THREE.MathUtils.lerp(u.rotationY, targetRot, Math.min(1, dt * 4.5));
          }

          // Fire Lasers when in range
          u.attackCooldown -= dt * heroSpeedMult;
          if (u.attackCooldown <= 0 && distToTarget <= spec.range && gameStateRef.current === 'playing') {
            u.attackCooldown = spec.fireRateSec * (0.9 + Math.random() * 0.2);
            const aiDmgMult = owner.isHuman
              ? 1.0
              : AI_DIFFICULTY_MULTIPLIERS[owner.difficulty].damageMult;
            const dmg = spec.damage * aiDmgMult;
            const colorHex = ARMY_COLORS[owner.colorId].num;
            const isHeavyShot =
              u.type === 'carrier' || u.type === 'cruiser' || u.type === 'hero_flagship';

            if (targetUnit && Math.hypot(targetUnit.x - u.x, targetUnit.z - u.z) <= spec.range) {
              targetUnit.hp -= dmg;
              targetUnit.hitFlashTimer = 0.06;
              if (targetUnit.hp <= 0) {
                owner.kills += 1;
              }
              lasers.push({
                id: `las_${u.id}_${Date.now()}_${Math.random()}`,
                fromX: u.x,
                fromY: u.y,
                fromZ: u.z,
                toX: targetUnit.x,
                toY: targetUnit.y,
                toZ: targetUnit.z,
                colorHex,
                width: isHeavyShot ? 2.5 : 1.2,
                ttl: isHeavyShot ? 0.22 : 0.14,
                maxTtl: isHeavyShot ? 0.22 : 0.14,
                isHeavy: isHeavyShot,
              });
              if (Math.random() < 0.28) {
                soundAndHaptics.playLaserPew(isHeavyShot);
              }
            } else if (
              targetStation &&
              Math.hypot(targetStation.position.x - u.x, targetStation.position.z - u.z) <= spec.range + 1.5
            ) {
              if (targetStation.baseShield > 0) {
                const shieldAbsorb = Math.min(targetStation.baseShield, dmg);
                targetStation.baseShield -= shieldAbsorb;
                targetStation.baseHp -= Math.max(0, dmg - shieldAbsorb);
              } else {
                targetStation.baseHp -= dmg;
              }

              lasers.push({
                id: `las_st_${u.id}_${Date.now()}_${Math.random()}`,
                fromX: u.x,
                fromY: u.y,
                fromZ: u.z,
                toX: targetStation.position.x + (Math.random() - 0.5) * 0.6,
                toY: targetStation.position.y + (Math.random() - 0.5) * 0.4,
                toZ: targetStation.position.z + (Math.random() - 0.5) * 0.6,
                colorHex,
                width: isHeavyShot ? 2.5 : 1.2,
                ttl: 0.2,
                maxTtl: 0.2,
                isHeavy: isHeavyShot,
              });

              if (targetStation.baseHp <= 0 && !targetStation.defeated) {
                targetStation.baseHp = 0;
                targetStation.defeated = true;
                soundAndHaptics.playExplosion('carrier');
                hitstopTimer = 0.08;
                cameraShakeTrauma = 1.0;
                spawnParticleBurst(
                  targetStation.position.x,
                  targetStation.position.y,
                  targetStation.position.z,
                  ARMY_COLORS[targetStation.colorId].num,
                  36,
                  6.0
                );
                const deadStMesh = stationMeshes.get(targetStation.slotIndex);
                if (deadStMesh) deadStMesh.visible = false;
                callbacksRef.current.onStatusToast(`${targetStation.name} Base Station Destroyed!`);
              }
            }
          }
        }

        // Update 3D Unit Mesh transform, Selection Ring, & Trajectory Line
        if (mesh) {
          const hoverBob = Math.sin(matchElapsedSec * 2.4 + i) * 0.06;
          mesh.position.set(u.x, u.y + hoverBob, u.z);
          mesh.rotation.y = u.rotationY;
          mesh.rotation.z = THREE.MathUtils.clamp(-u.vx * 0.08, -0.3, 0.3);

          const selRing = mesh.getObjectByName('selection_ring');
          if (selRing) {
            selRing.visible = Boolean(u.selected);
            if (u.selected) {
              selRing.rotation.z = matchElapsedSec * 1.8;
            }
          }

          // Draw live trajectory line if unit is selected and has an active manual order
          if (u.selected) {
            let lineDest: { x: number; z: number } | null = null;
            let lineColor = 0x34d399;
            if (u.manualMoveTarget) {
              lineDest = u.manualMoveTarget;
              lineColor = 0x34d399;
            } else if (u.manualAttackTargetId) {
              const tEnemy = units.find((e) => e.id === u.manualAttackTargetId);
              if (tEnemy) {
                lineDest = { x: tEnemy.x, z: tEnemy.z };
                lineColor = 0xf43f5e;
              }
            } else if (typeof u.manualStationTargetSlot === 'number') {
              const tSt = factions.find((f) => f.slotIndex === u.manualStationTargetSlot);
              if (tSt) {
                lineDest = { x: tSt.position.x, z: tSt.position.z };
                lineColor = 0xf43f5e;
              }
            }
            if (lineDest) {
              const orderGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(u.x, 1.05, u.z),
                new THREE.Vector3(lineDest.x, 1.05, lineDest.z),
              ]);
              const orderMat = new THREE.LineBasicMaterial({
                color: lineColor,
                transparent: true,
                opacity: 0.7,
              });
              orderLinesRoot.add(new THREE.Line(orderGeo, orderMat));
            }
          }

          if (u.hitFlashTimer > 0) {
            u.hitFlashTimer = Math.max(0, u.hitFlashTimer - dt);
          }
        }
      }

      // 5. Update Active Laser Beams
      for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.ttl -= dt;
        let lineMesh = laserMeshes.get(l.id);
        if (l.ttl <= 0) {
          if (lineMesh) {
            lasersRoot.remove(lineMesh);
            lineMesh.geometry.dispose();
            (lineMesh.material as THREE.Material).dispose();
            laserMeshes.delete(l.id);
          }
          lasers.splice(i, 1);
          continue;
        }
        if (!lineMesh) {
          const lGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(l.fromX, l.fromY, l.fromZ),
            new THREE.Vector3(l.toX, l.toY, l.toZ),
          ]);
          const lMat = new THREE.LineBasicMaterial({
            color: l.colorHex,
            transparent: true,
            opacity: 0.95,
          });
          lineMesh = new THREE.Line(lGeo, lMat);
          lasersRoot.add(lineMesh);
          laserMeshes.set(l.id, lineMesh);
        } else {
          (lineMesh.material as THREE.LineBasicMaterial).opacity = Math.max(
            0.1,
            l.ttl / l.maxTtl
          );
        }
      }

      // 6. Update Pooled Particle Ring Buffer in-place (Zero GC)
      for (let i = 0; i < PARTICLE_CAP; i++) {
        const p = particles[i];
        if (!p.active) {
          _scratchScale.setScalar(0);
          _scratchMat4.compose(_scratchVecA.set(0, -100, 0), _scratchQuat.identity(), _scratchScale);
          particleInstanced.setMatrixAt(i, _scratchMat4);
          continue;
        }
        if (p.isAmbient) {
          p.x += p.vx * dt;
          p.y += Math.sin(matchElapsedSec + i) * 0.12 * dt;
          p.z += p.vz * dt;
          if (p.x > MAP_HALF_EXTENT) p.x = -MAP_HALF_EXTENT;
          if (p.x < -MAP_HALF_EXTENT) p.x = MAP_HALF_EXTENT;
          if (p.z > MAP_HALF_EXTENT) p.z = -MAP_HALF_EXTENT;
          if (p.z < -MAP_HALF_EXTENT) p.z = MAP_HALF_EXTENT;
          _scratchVecA.set(p.x, p.y, p.z);
          _scratchScale.setScalar(p.scale);
          _scratchMat4.compose(_scratchVecA, _scratchQuat.identity(), _scratchScale);
          particleInstanced.setMatrixAt(i, _scratchMat4);
          particleInstanced.setColorAt(i, _scratchColor.setHex(p.colorHex));
        } else {
          p.life -= dt;
          if (p.life <= 0) {
            p.active = false;
            continue;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy -= 2.2 * dt;
          const lifeRatio = Math.max(0.05, p.life / p.maxLife);
          _scratchVecA.set(p.x, Math.max(0.05, p.y), p.z);
          _scratchScale.setScalar(p.scale * lifeRatio);
          _scratchMat4.compose(_scratchVecA, _scratchQuat.identity(), _scratchScale);
          particleInstanced.setMatrixAt(i, _scratchMat4);
          particleInstanced.setColorAt(i, _scratchColor.setHex(p.colorHex));
        }
      }
      particleInstanced.instanceMatrix.needsUpdate = true;
      if (particleInstanced.instanceColor) {
        particleInstanced.instanceColor.needsUpdate = true;
      }

      // 7. Camera Trauma Shake Decay
      if (cameraShakeTrauma > 0) {
        const shake = cameraShakeTrauma * cameraShakeTrauma * 0.22;
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        cameraShakeTrauma = Math.max(0, cameraShakeTrauma - dt * 1.8);
      }

      // 8. Evaluate Match Victory / Defeat Outcome
      if (gameStateRef.current === 'playing') {
        const outcome = evaluateMatchOutcome(factions);
        if (outcome.finished) {
          const human = factions.find((f) => f.isHuman) ?? factions[0];
          const score = calculateMatchScore(human, matchElapsedSec);
          bestScoreRecorded = Math.max(bestScoreRecorded, score);
          const winningFac =
            factions.find((f) => f.team === outcome.winningTeam && !f.defeated) ?? human;
          const carriersCount = units.filter(
            (u) => u.ownerSlot === human.slotIndex && u.type === 'carrier'
          ).length;

          callbacksRef.current.onMatchEnd({
            victory: outcome.humanVictory,
            winnerName: winningFac.name,
            winnerTeam: outcome.winningTeam ?? 1,
            clearTimeSec: Math.round(matchElapsedSec),
            score,
            bestScore: bestScoreRecorded,
            hostilesDestroyed: human.kills,
            oreMined: Math.round(human.oreMinedTotal),
            maxTierReached: human.baseTier,
            carriersDeployed: carriersCount,
          });
        }
      }

      // 9. Throttled HUD Sync (5 Hz)
      hudSyncTimer += dt;
      if (hudSyncTimer >= 0.2) {
        hudSyncTimer = 0;
        syncHudImmediate();
      }
    };

    let frameId = 0;
    let isDisposed = false;
    const clock = new THREE.Clock();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (isDisposed) return;
      const rawDt = clock.getDelta();
      advanceSimulation(rawDt);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      }
    };

    if (isSoftwareGl) {
      tick();
    } else {
      renderer.setAnimationLoop(tick);
    }

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    return () => {
      isDisposed = true;
      renderer.setAnimationLoop(null);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#040812]">
      {passthroughActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, rgba(14, 116, 144, 0.24) 0%, rgba(15, 23, 42, 0.82) 60%, rgba(4, 8, 18, 0.95) 100%)',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full h-full object-cover opacity-55"
          />
          <div className="absolute inset-6 border border-cyan-400/20 rounded-2xl pointer-events-none" />
        </div>
      )}

      <div
        ref={mountRef}
        data-testid="xr-canvas-container"
        className="relative w-full h-full z-10"
      />
    </div>
  );
};
