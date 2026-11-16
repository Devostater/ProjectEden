import * as THREE from 'three';
import { BaseTier, BuildingType, UnitType } from './types';

// Shared geometry cache to avoid redundant allocations
const geoCache = new Map<string, THREE.BufferGeometry>();

function getCachedGeo(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = factory();
    geoCache.set(key, g);
  }
  return g;
}

export function createHoloPair(
  geometry: THREE.BufferGeometry,
  colorHex: number,
  coreOpacity = 0.46,
  wireOpacity = 0.92,
  roughness = 0.25,
  metalness = 0.75
): THREE.Group {
  const group = new THREE.Group();

  const coreMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.45,
    roughness,
    metalness,
    transparent: true,
    opacity: coreOpacity,
    depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(geometry, coreMat);
  group.add(coreMesh);

  const edgesGeo = new THREE.EdgesGeometry(geometry, 18);
  const wireMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: wireOpacity,
  });
  const wireSegments = new THREE.LineSegments(edgesGeo, wireMat);
  group.add(wireSegments);

  group.userData.coreMat = coreMat;
  group.userData.wireMat = wireMat;
  return group;
}

/**
 * Creates the Living Room furniture anchors & passthrough spatial grid
 * Supports smooth blending between physical furniture occlusion & holographic tactical wireframe
 */
export function createLivingRoomEnvironment(): {
  root: THREE.Group;
  floatingDeck: THREE.Group;
  setBlendMode: (tacticalOverlayAlpha: number, passthroughActive: boolean) => void;
  setFloatingArenaTransform: (elevationY: number, boundaryScale: number) => void;
  updateGuardianPolygon: (points: Array<{ x: number; z: number }>) => void;
} {
  const root = new THREE.Group();
  const solidMats: THREE.MeshStandardMaterial[] = [];
  const wireMats: THREE.LineBasicMaterial[] = [];

  const makeFurniturePart = (
    geo: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    solidColor = 0x162238,
    wireColor = 0x38bdf8
  ) => {
    const part = new THREE.Group();
    part.position.set(x, y, z);

    const sMat = new THREE.MeshStandardMaterial({
      color: solidColor,
      roughness: 0.78,
      metalness: 0.15,
      transparent: true,
      opacity: 0.72,
    });
    solidMats.push(sMat);

    const mesh = new THREE.Mesh(geo, sMat);
    mesh.receiveShadow = true;
    part.add(mesh);

    const edges = new THREE.EdgesGeometry(geo);
    const wMat = new THREE.LineBasicMaterial({
      color: wireColor,
      transparent: true,
      opacity: 0.65,
    });
    wireMats.push(wMat);

    const line = new THREE.LineSegments(edges, wMat);
    part.add(line);
    return part;
  };

  // 1. Physical Living Room Floor & Passthrough Guardian Boundary (44m x 44m)
  const floorGeo = new THREE.PlaneGeometry(44, 44);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x050b18,
    roughness: 0.9,
    metalness: 0.1,
    transparent: true,
    opacity: 0.55,
  });
  solidMats.push(floorMat);
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = 0;
  floorMesh.receiveShadow = true;
  root.add(floorMesh);

  const floorGridHelper = new THREE.GridHelper(44, 22, 0x0e7490, 0x0f172a);
  floorGridHelper.position.y = 0.02;
  root.add(floorGridHelper);

  // Passthrough Room Boundary Walls (Guardian Chaperone Laser Perimeter)
  const guardianWallsGroup = new THREE.Group();
  const boundaryWallMat = new THREE.LineBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.55,
  });
  wireMats.push(boundaryWallMat);

  const buildDefaultBoundaryWalls = (pts: Array<{ x: number; z: number }>) => {
    guardianWallsGroup.clear();
    if (pts.length < 3) return;
    const wallHeight = 5.5;
    const bottomPts: THREE.Vector3[] = [];
    const midPts: THREE.Vector3[] = [];
    const topPts: THREE.Vector3[] = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const next = pts[(i + 1) % pts.length];
      bottomPts.push(new THREE.Vector3(p.x, 0.05, p.z), new THREE.Vector3(next.x, 0.05, next.z));
      midPts.push(
        new THREE.Vector3(p.x, wallHeight * 0.45, p.z),
        new THREE.Vector3(next.x, wallHeight * 0.45, next.z)
      );
      topPts.push(
        new THREE.Vector3(p.x, wallHeight, p.z),
        new THREE.Vector3(next.x, wallHeight, next.z)
      );

      // Corner Guardian Beacon Pillar
      const pillarGeo = new THREE.CylinderGeometry(0.12, 0.12, wallHeight, 8);
      const pillar = createHoloPair(pillarGeo, 0x06b6d4, 0.28, 0.85);
      pillar.position.set(p.x, wallHeight / 2, p.z);
      guardianWallsGroup.add(pillar);
    }

    guardianWallsGroup.add(
      new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bottomPts), boundaryWallMat),
      new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(midPts), boundaryWallMat),
      new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(topPts), boundaryWallMat)
    );
  };

  buildDefaultBoundaryWalls([
    { x: -20.5, z: -20.5 },
    { x: 20.5, z: -20.5 },
    { x: 20.5, z: 20.5 },
    { x: -20.5, z: 20.5 },
  ]);
  root.add(guardianWallsGroup);

  // Floating Tactical Battle Deck (Suspended in the middle of the living room!)
  const floatingDeck = new THREE.Group();
  floatingDeck.position.set(0, 1.05, 0);

  const deckGrid = new THREE.GridHelper(40, 40, 0x06b6d4, 0x164e63);
  deckGrid.position.y = 0;
  floatingDeck.add(deckGrid);

  const rugRingGeo = new THREE.RingGeometry(7.8, 8.05, 64);
  const rugRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const rugRing = new THREE.Mesh(rugRingGeo, rugRingMat);
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.y = 0.02;
  floatingDeck.add(rugRing);

  const outerRingGeo = new THREE.RingGeometry(15.3, 15.6, 96);
  const outerRing = new THREE.Mesh(outerRingGeo, rugRingMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.02;
  floatingDeck.add(outerRing);

  const boundaryFramePts = [
    new THREE.Vector3(-19.8, 0.03, -19.8),
    new THREE.Vector3(19.8, 0.03, -19.8),
    new THREE.Vector3(19.8, 0.03, 19.8),
    new THREE.Vector3(-19.8, 0.03, 19.8),
    new THREE.Vector3(-19.8, 0.03, -19.8),
  ];
  const boundaryFrameLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(boundaryFramePts),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
  );
  floatingDeck.add(boundaryFrameLine);
  root.add(floatingDeck);

  // 2. Central Living Room Coffee Table Holoprojector (Projects the floating battle upward!)
  const coffeeTable = new THREE.Group();
  coffeeTable.position.set(0, 0, 0);
  coffeeTable.add(
    makeFurniturePart(new THREE.BoxGeometry(4.4, 0.14, 2.6), 0, 0.52, 0, 0x1e293b, 0x22d3ee)
  );
  const legGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.5, 8);
  coffeeTable.add(makeFurniturePart(legGeo, -2.0, 0.25, -1.1, 0x0f172a, 0x06b6d4));
  coffeeTable.add(makeFurniturePart(legGeo, 2.0, 0.25, -1.1, 0x0f172a, 0x06b6d4));
  coffeeTable.add(makeFurniturePart(legGeo, -2.0, 0.25, 1.1, 0x0f172a, 0x06b6d4));
  coffeeTable.add(makeFurniturePart(legGeo, 2.0, 0.25, 1.1, 0x0f172a, 0x06b6d4));

  // Holographic upward emitter cone from Coffee Table to Floating Battle Level
  const emitterConeGeo = new THREE.ConeGeometry(3.2, 1.6, 24, 1, true);
  const emitterConeMat = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    wireframe: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const emitterCone = new THREE.Mesh(emitterConeGeo, emitterConeMat);
  emitterCone.rotation.x = Math.PI;
  emitterCone.position.set(0, 1.35, 0);
  coffeeTable.add(emitterCone);
  root.add(coffeeTable);

  // 3. Player South Sectional Sofa Anchor (Composite 5-part mesh)
  const sofa = new THREE.Group();
  sofa.position.set(0, 0, 17.8);
  sofa.add(
    makeFurniturePart(new THREE.BoxGeometry(8.2, 0.52, 2.1), 0, 0.26, 0, 0x172554, 0x38bdf8)
  );
  sofa.add(
    makeFurniturePart(new THREE.BoxGeometry(8.2, 0.85, 0.42), 0, 0.8, 0.84, 0x1e3a8a, 0x38bdf8)
  );
  sofa.add(
    makeFurniturePart(new THREE.BoxGeometry(0.48, 0.68, 2.1), -3.9, 0.58, 0, 0x1e3a8a, 0x38bdf8)
  );
  sofa.add(
    makeFurniturePart(new THREE.BoxGeometry(0.48, 0.68, 2.1), 3.9, 0.58, 0, 0x1e3a8a, 0x38bdf8)
  );
  root.add(sofa);

  // 4. North Media Console & Wall TV Anchor (Hostile Spawn Anchor)
  const mediaWall = new THREE.Group();
  mediaWall.position.set(0, 0, -17.8);
  mediaWall.add(
    makeFurniturePart(new THREE.BoxGeometry(7.8, 0.85, 1.3), 0, 0.42, 0, 0x1e293b, 0xf43f5e)
  );
  mediaWall.add(
    makeFurniturePart(new THREE.BoxGeometry(6.6, 3.2, 0.16), 0, 2.9, -0.45, 0x090d16, 0xf43f5e)
  );
  root.add(mediaWall);

  // 5. West Bookshelf & East Credenza Anchors (Flank AI Spawn Anchors)
  const westShelf = new THREE.Group();
  westShelf.position.set(-18.0, 0, 0);
  westShelf.add(
    makeFurniturePart(new THREE.BoxGeometry(1.5, 3.4, 6.4), 0, 1.7, 0, 0x1e293b, 0xf59e0b)
  );
  root.add(westShelf);

  const eastSideboard = new THREE.Group();
  eastSideboard.position.set(18.0, 0, 0);
  eastSideboard.add(
    makeFurniturePart(new THREE.BoxGeometry(1.5, 1.6, 6.4), 0, 0.8, 0, 0x1e293b, 0x10b981)
  );
  eastSideboard.add(
    makeFurniturePart(new THREE.CylinderGeometry(0.08, 0.35, 2.8, 10), 0, 1.4, -3.8, 0x334155, 0x10b981)
  );
  eastSideboard.add(
    makeFurniturePart(new THREE.ConeGeometry(0.58, 0.68, 12, 1, true), 0, 2.9, -3.8, 0x475569, 0x34d399)
  );
  root.add(eastSideboard);

  const setBlendMode = (tacticalOverlayAlpha: number, passthroughActive: boolean) => {
    const clamped = Math.max(0.05, Math.min(1.0, tacticalOverlayAlpha));
    for (const sm of solidMats) {
      sm.opacity = passthroughActive ? (1.0 - clamped * 0.78) * 0.28 : 0.72 - clamped * 0.35;
    }
    for (const wm of wireMats) {
      wm.opacity = 0.32 + clamped * 0.68;
    }
    rugRingMat.opacity = 0.28 + clamped * 0.65;
  };

  const setFloatingArenaTransform = (elevationY: number, boundaryScale: number) => {
    floatingDeck.position.y = elevationY;
    floatingDeck.scale.set(boundaryScale, 1, boundaryScale);
  };

  const updateGuardianPolygon = (points: Array<{ x: number; z: number }>) => {
    if (points.length >= 3) {
      buildDefaultBoundaryWalls(points);
    }
  };

  return {
    root,
    floatingDeck,
    setBlendMode,
    setFloatingArenaTransform,
    updateGuardianPolygon,
  };
}

/**
 * Composite 9-part Holographic Space Station Base with Tier 1, 2, 3 visual upgrades
 * and orbiting tech-tree building modules
 */
export function createSpaceStationGroup(colorHex: number): THREE.Group {
  const station = new THREE.Group();

  // 1. Primary Silhouette: Central Octagonal Command Core
  const coreGeo = getCachedGeo('st_core', () => new THREE.OctahedronGeometry(0.62, 1));
  const corePart = createHoloPair(coreGeo, colorHex, 0.55, 0.95, 0.2, 0.85);
  station.add(corePart);

  // 2. Secondary Read: Tier 1 Rotating Docking Habitat Ring
  const ring1Geo = getCachedGeo('st_ring1', () => new THREE.TorusGeometry(1.05, 0.09, 10, 28));
  const ring1 = createHoloPair(ring1Geo, colorHex, 0.45, 0.9, 0.48, 0.5);
  ring1.rotation.x = Math.PI / 2;
  ring1.name = 'tier1_ring';
  station.add(ring1);

  // 3. Tier 1 Spoke Struts (4 crossbars)
  const spokeGeo = getCachedGeo('st_spoke', () => new THREE.BoxGeometry(2.05, 0.07, 0.12));
  const spokeA = createHoloPair(spokeGeo, colorHex, 0.4, 0.8, 0.5, 0.5);
  const spokeB = createHoloPair(spokeGeo, colorHex, 0.4, 0.8, 0.5, 0.5);
  spokeB.rotation.y = Math.PI / 2;
  station.add(spokeA, spokeB);

  // 4. Tier 2 Upgrade: Command Citadel Spire & Dual Sensor Arrays
  const tier2Group = new THREE.Group();
  tier2Group.name = 'tier2_group';
  const spireGeo = getCachedGeo('st_spire', () => new THREE.ConeGeometry(0.36, 1.35, 6));
  const upperSpire = createHoloPair(spireGeo, colorHex, 0.5, 0.95, 0.18, 0.85);
  upperSpire.position.y = 0.78;
  const lowerSpire = createHoloPair(spireGeo, colorHex, 0.5, 0.95, 0.18, 0.85);
  lowerSpire.rotation.x = Math.PI;
  lowerSpire.position.y = -0.78;

  const ring2Geo = getCachedGeo('st_ring2', () => new THREE.TorusGeometry(1.42, 0.06, 8, 32));
  const ring2 = createHoloPair(ring2Geo, colorHex, 0.4, 0.9, 0.3, 0.7);
  ring2.rotation.x = Math.PI / 3;
  tier2Group.add(upperSpire, lowerSpire, ring2);
  tier2Group.visible = false;
  station.add(tier2Group);

  // 5. Tier 3 Upgrade: Starlight Dreadnought Bastion Halo & 4 Capital Pylons
  const tier3Group = new THREE.Group();
  tier3Group.name = 'tier3_group';
  const ring3Geo = getCachedGeo('st_ring3', () => new THREE.TorusGeometry(1.85, 0.1, 10, 40));
  const ring3 = createHoloPair(ring3Geo, colorHex, 0.52, 0.98, 0.15, 0.9);
  ring3.rotation.x = Math.PI / 2;
  tier3Group.add(ring3);

  const pylonGeo = getCachedGeo('st_pylon', () => new THREE.BoxGeometry(0.24, 1.4, 0.36));
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const pylon = createHoloPair(pylonGeo, colorHex, 0.5, 0.95, 0.25, 0.8);
    pylon.position.set(Math.cos(angle) * 1.85, 0, Math.sin(angle) * 1.85);
    pylon.lookAt(0, 0, 0);
    tier3Group.add(pylon);
  }
  tier3Group.visible = false;
  station.add(tier3Group);

  // 6. Orbiting Tech Building Satellites Container
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = 'buildings_group';
  station.add(buildingsGroup);

  // 7. Ground Contact Holographic Beacon Shadow
  const shadowGeo = getCachedGeo('st_shadow', () => new THREE.CircleGeometry(1.5, 32));
  const shadowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = -1.12;
  station.add(shadowDisc);

  return station;
}

export function syncStationVisuals(
  stationGroup: THREE.Group,
  tier: BaseTier,
  buildings: BuildingType[],
  colorHex: number,
  elapsedTime: number
) {
  const tier1Ring = stationGroup.getObjectByName('tier1_ring');
  const tier2Group = stationGroup.getObjectByName('tier2_group');
  const tier3Group = stationGroup.getObjectByName('tier3_group');
  const buildingsGroup = stationGroup.getObjectByName('buildings_group') as THREE.Group | undefined;

  if (tier1Ring) {
    tier1Ring.rotation.z = elapsedTime * 0.45;
  }
  if (tier2Group) {
    tier2Group.visible = tier >= 2;
    tier2Group.rotation.y = -elapsedTime * 0.6;
  }
  if (tier3Group) {
    tier3Group.visible = tier >= 3;
    tier3Group.rotation.y = elapsedTime * 0.35;
  }

  if (buildingsGroup) {
    const currentCount = buildingsGroup.children.length;
    if (currentCount < buildings.length) {
      for (let i = currentCount; i < buildings.length; i++) {
        const bType = buildings[i];
        const sat = createBuildingSatelliteMesh(bType, colorHex);
        buildingsGroup.add(sat);
      }
    }
    buildingsGroup.children.forEach((child, idx) => {
      const orbitAngle = elapsedTime * 0.55 + (idx * Math.PI * 2) / Math.max(1, buildingsGroup.children.length);
      const radius = 2.25;
      child.position.set(
        Math.cos(orbitAngle) * radius,
        Math.sin(elapsedTime * 1.5 + idx) * 0.18,
        Math.sin(orbitAngle) * radius
      );
      child.rotation.y = -orbitAngle;
    });
  }
}

function createBuildingSatelliteMesh(type: BuildingType, colorHex: number): THREE.Group {
  const g = new THREE.Group();
  if (type === 'refinery') {
    const tank = createHoloPair(new THREE.CylinderGeometry(0.22, 0.22, 0.52, 8), colorHex, 0.5, 0.95);
    const ring = createHoloPair(new THREE.TorusGeometry(0.32, 0.04, 6, 16), 0xf59e0b, 0.6, 0.95);
    g.add(tank, ring);
  } else if (type === 'sensor_array') {
    const dish = createHoloPair(new THREE.ConeGeometry(0.34, 0.25, 12, 1, true), 0x38bdf8, 0.5, 0.95);
    dish.rotation.x = -Math.PI / 3;
    const mast = createHoloPair(new THREE.CylinderGeometry(0.05, 0.08, 0.55, 6), colorHex, 0.5, 0.9);
    g.add(dish, mast);
  } else if (type === 'orbital_shipyard') {
    const frame = createHoloPair(new THREE.BoxGeometry(0.58, 0.32, 0.72), colorHex, 0.35, 0.95);
    const core = createHoloPair(new THREE.OctahedronGeometry(0.18, 0), 0x22d3ee, 0.7, 1.0);
    g.add(frame, core);
  } else if (type === 'defense_grid') {
    const base = createHoloPair(new THREE.CylinderGeometry(0.24, 0.3, 0.22, 8), colorHex, 0.55, 0.95);
    const barrelL = createHoloPair(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), 0xf43f5e, 0.7, 1.0);
    barrelL.rotation.x = Math.PI / 2;
    barrelL.position.set(-0.08, 0.14, 0.18);
    const barrelR = barrelL.clone();
    barrelR.position.x = 0.08;
    g.add(base, barrelL, barrelR);
  } else {
    // titan_foundry
    const gantry = createHoloPair(new THREE.TorusGeometry(0.45, 0.06, 8, 20), 0xeab308, 0.6, 1.0);
    const spire = createHoloPair(new THREE.OctahedronGeometry(0.26, 1), colorHex, 0.65, 1.0);
    g.add(gantry, spire);
  }
  return g;
}

/**
 * Builds composite 4–11 part holographic wireframe + translucent PBR meshes for each unit class
 */
export function createUnitHoloMesh(type: UnitType, colorHex: number): THREE.Group {
  const root = new THREE.Group();

  switch (type) {
    case 'miner': {
      // 5-part Industrial Miner Drone
      const body = createHoloPair(
        getCachedGeo('m_body', () => new THREE.CylinderGeometry(0.18, 0.24, 0.56, 8)),
        colorHex,
        0.52,
        0.92,
        0.55,
        0.6
      );
      body.rotation.x = Math.PI / 2;
      const PodL = createHoloPair(
        getCachedGeo('m_pod', () => new THREE.BoxGeometry(0.12, 0.14, 0.42)),
        0xf59e0b,
        0.6,
        0.95,
        0.25,
        0.8
      );
      PodL.position.set(-0.22, 0, 0);
      const PodR = PodL.clone();
      PodR.position.set(0.22, 0, 0);
      const claw = createHoloPair(
        getCachedGeo('m_claw', () => new THREE.ConeGeometry(0.14, 0.28, 4)),
        0x38bdf8,
        0.65,
        1.0,
        0.15,
        0.9
      );
      claw.rotation.x = Math.PI / 2;
      claw.position.set(0, 0, 0.36);
      root.add(body, PodL, PodR, claw);
      break;
    }

    case 'interceptor': {
      // 6-part Delta Dart Interceptor
      const hull = createHoloPair(
        getCachedGeo('i_hull', () => new THREE.ConeGeometry(0.22, 0.85, 4)),
        colorHex,
        0.5,
        0.95,
        0.2,
        0.85
      );
      hull.rotation.x = Math.PI / 2;
      const wings = createHoloPair(
        getCachedGeo('i_wings', () => new THREE.BoxGeometry(0.88, 0.04, 0.36)),
        colorHex,
        0.42,
        0.92,
        0.5,
        0.6
      );
      wings.position.set(0, 0, -0.08);
      const canopy = createHoloPair(
        getCachedGeo('i_canopy', () => new THREE.BoxGeometry(0.14, 0.1, 0.32)),
        0xffffff,
        0.65,
        0.9,
        0.1,
        0.95
      );
      canopy.position.set(0, 0.08, 0.08);
      const thruster = createHoloPair(
        getCachedGeo('i_thrust', () => new THREE.CylinderGeometry(0.08, 0.12, 0.18, 6)),
        0x38bdf8,
        0.75,
        1.0
      );
      thruster.rotation.x = Math.PI / 2;
      thruster.position.set(0, 0, -0.45);
      root.add(hull, wings, canopy, thruster);
      break;
    }

    case 'frigate': {
      // 7-part Twin-Boom Pulse Frigate
      const hull = createHoloPair(
        getCachedGeo('f_hull', () => new THREE.BoxGeometry(0.36, 0.24, 1.15)),
        colorHex,
        0.5,
        0.95,
        0.3,
        0.8
      );
      const prow = createHoloPair(
        getCachedGeo('f_prow', () => new THREE.ConeGeometry(0.26, 0.48, 6)),
        colorHex,
        0.58,
        0.98,
        0.15,
        0.9
      );
      prow.rotation.x = Math.PI / 2;
      prow.position.set(0, 0, 0.78);
      const boomGeo = getCachedGeo('f_boom', () => new THREE.BoxGeometry(0.14, 0.16, 0.92));
      const boomL = createHoloPair(boomGeo, colorHex, 0.45, 0.9, 0.55, 0.6);
      boomL.position.set(-0.34, 0, -0.05);
      const boomR = createHoloPair(boomGeo, colorHex, 0.45, 0.9, 0.55, 0.6);
      boomR.position.set(0.34, 0, -0.05);
      const bridge = createHoloPair(
        getCachedGeo('f_bridge', () => new THREE.BoxGeometry(0.2, 0.22, 0.35)),
        0xffffff,
        0.6,
        0.95,
        0.15,
        0.9
      );
      bridge.position.set(0, 0.2, -0.15);
      root.add(hull, prow, boomL, boomR, bridge);
      break;
    }

    case 'cruiser': {
      // 8-part Heavy Aegis Siege Cruiser
      const mainHull = createHoloPair(
        getCachedGeo('c_hull', () => new THREE.BoxGeometry(0.55, 0.34, 1.55)),
        colorHex,
        0.54,
        0.96,
        0.25,
        0.85
      );
      const hammerProw = createHoloPair(
        getCachedGeo('c_prow', () => new THREE.BoxGeometry(0.88, 0.26, 0.38)),
        colorHex,
        0.6,
        0.98,
        0.5,
        0.65
      );
      hammerProw.position.set(0, 0, 0.72);
      const tower = createHoloPair(
        getCachedGeo('c_tower', () => new THREE.BoxGeometry(0.32, 0.36, 0.45)),
        colorHex,
        0.55,
        0.95,
        0.18,
        0.9
      );
      tower.position.set(0, 0.3, -0.32);
      const cannon = createHoloPair(
        getCachedGeo('c_cannon', () => new THREE.CylinderGeometry(0.06, 0.09, 0.85, 8)),
        0x38bdf8,
        0.7,
        1.0,
        0.15,
        0.95
      );
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(0, 0.24, 0.35);
      root.add(mainHull, hammerProw, tower, cannon);
      break;
    }

    case 'carrier': {
      // 11-part Game-Ending Leviathan Titan Carrier
      const coreDeck = createHoloPair(
        getCachedGeo('t_deck', () => new THREE.BoxGeometry(1.15, 0.42, 2.65)),
        colorHex,
        0.52,
        0.98,
        0.22,
        0.88
      );
      const portWing = createHoloPair(
        getCachedGeo('t_wing', () => new THREE.BoxGeometry(0.48, 0.26, 2.25)),
        colorHex,
        0.46,
        0.95,
        0.55,
        0.65
      );
      portWing.position.set(-0.88, -0.04, 0.1);
      const stbdWing = portWing.clone();
      stbdWing.position.set(0.88, -0.04, 0.1);

      // Illuminated Holographic Launch Trench
      const launchBay = createHoloPair(
        getCachedGeo('t_bay', () => new THREE.BoxGeometry(0.55, 0.16, 2.4)),
        0x38bdf8,
        0.75,
        1.0,
        0.1,
        0.95
      );
      launchBay.position.set(0, 0.18, 0.12);

      // Command Citadel Bridge
      const bridgeSpire = createHoloPair(
        getCachedGeo('t_spire', () => new THREE.ConeGeometry(0.35, 0.78, 6)),
        colorHex,
        0.6,
        1.0,
        0.18,
        0.9
      );
      bridgeSpire.position.set(0, 0.55, -0.65);

      // Ventral Warp Crystal Core
      const warpCore = createHoloPair(
        getCachedGeo('t_warp', () => new THREE.OctahedronGeometry(0.38, 1)),
        0xfef08a,
        0.8,
        1.0,
        0.1,
        0.98
      );
      warpCore.position.set(0, -0.25, 0);

      // Halo Shield Generator Ring
      const halo = createHoloPair(
        getCachedGeo('t_halo', () => new THREE.TorusGeometry(0.95, 0.06, 8, 28)),
        colorHex,
        0.55,
        0.98,
        0.3,
        0.85
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.set(0, 0.15, -0.2);

      root.add(coreDeck, portWing, stbdWing, launchBay, bridgeSpire, warpCore, halo);
      break;
    }

    case 'hero_flagship': {
      // 9-part Commander Flagship with Crown Halo
      const fuselage = createHoloPair(
        getCachedGeo('h_hull', () => new THREE.ConeGeometry(0.38, 1.75, 6)),
        colorHex,
        0.6,
        1.0,
        0.15,
        0.92
      );
      fuselage.rotation.x = Math.PI / 2;
      const wingSweep = createHoloPair(
        getCachedGeo('h_wing', () => new THREE.BoxGeometry(1.55, 0.08, 0.65)),
        colorHex,
        0.5,
        0.98,
        0.45,
        0.75
      );
      wingSweep.position.set(0, 0, -0.2);
      const crownHalo = createHoloPair(
        getCachedGeo('h_crown', () => new THREE.TorusGeometry(0.58, 0.045, 8, 24)),
        0xfef08a,
        0.78,
        1.0,
        0.1,
        0.98
      );
      crownHalo.rotation.x = Math.PI / 2;
      crownHalo.position.set(0, 0.22, -0.15);
      root.add(fuselage, wingSweep, crownHalo);
      break;
    }

    case 'micro_drone':
    default: {
      // 4-part Swarm Micro-Drone
      const diamond = createHoloPair(
        getCachedGeo('d_core', () => new THREE.OctahedronGeometry(0.18, 0)),
        colorHex,
        0.62,
        1.0,
        0.15,
        0.9
      );
      const fin = createHoloPair(
        getCachedGeo('d_fin', () => new THREE.BoxGeometry(0.42, 0.03, 0.18)),
        colorHex,
        0.5,
        0.95,
        0.45,
        0.7
      );
      root.add(diamond, fin);
      break;
    }
  }

  // Holographic Unit Selection Ring (visible when unit is selected by mouse or VR controller)
  const selRingGeo = getCachedGeo('unit_sel_ring', () => new THREE.RingGeometry(0.68, 0.82, 28));
  const selRingMat = new THREE.MeshBasicMaterial({
    color: 0x34d399,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const selRing = new THREE.Mesh(selRingGeo, selRingMat);
  selRing.rotation.x = -Math.PI / 2;
  selRing.position.y = -0.35;
  selRing.name = 'selection_ring';
  selRing.visible = false;
  root.add(selRing);

  return root;
}

export type WristWatchActionId =
  | 'TOGGLE_PANEL'
  | 'TOGGLE_PIN'
  | 'HEIGHT_UP'
  | 'HEIGHT_DOWN'
  | 'SCALE_UP'
  | 'SCALE_DOWN'
  | 'TILT_LEFT'
  | 'TILT_RIGHT'
  | 'DEPLOY_MINER'
  | 'DEPLOY_INTERCEPTOR'
  | 'DEPLOY_FRIGATE'
  | 'DEPLOY_CARRIER'
  | 'UPGRADE_TIER'
  | 'SELECT_COMBAT';

export interface VirtualHandRig {
  group: THREE.Group;
  wristWatchBezel?: THREE.Group;
  wristPanelRoot?: THREE.Group;
  interactiveMeshes: THREE.Object3D[];
  animatePose: (elapsedSec: number, isPinching: boolean) => void;
  updateWatchDisplay?: (data: {
    open: boolean;
    pinnedInRoom: boolean;
    ore: number;
    energy: number;
    tier: BaseTier;
    supplyText: string;
    selectedCount: number;
    battleElevationY: number;
    panelScale: number;
    panelTiltDeg: number;
  }) => void;
}

/**
 * Creates an Articulated 3D Holographic Virtual Hand (Left & Right)
 * Left Hand includes a 3D Tactical Wristwatch + Floating Adjustable/Toggle Holographic Command Panel
 */
export function createQuestHandControllerMesh(
  side: 'left' | 'right',
  colorHex: number
): VirtualHandRig {
  const group = new THREE.Group();
  const mirror = side === 'left' ? 1 : -1;
  const interactiveMeshes: THREE.Object3D[] = [];

  // Scale hand so it is clearly visible both in Room-Walk Desktop view and WebXR
  const handRoot = new THREE.Group();
  handRoot.scale.setScalar(4.8);
  group.add(handRoot);

  // 1. Cybernetic Wrist Gauntlet Cuff
  const cuffGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.09, 12);
  const cuff = createHoloPair(cuffGeo, colorHex, 0.48, 0.95, 0.25, 0.85);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.01, 0.09);
  handRoot.add(cuff);

  // 2. Contoured Holographic Palm
  const palmGeo = new THREE.BoxGeometry(0.088, 0.026, 0.095);
  const palm = createHoloPair(palmGeo, colorHex, 0.52, 0.96, 0.2, 0.88);
  palm.position.set(0, 0, 0);
  handRoot.add(palm);

  // Palm Core Energy Node
  const palmNode = createHoloPair(new THREE.OctahedronGeometry(0.018, 0), 0xfef08a, 0.8, 1.0);
  palmNode.position.set(0, 0.016, 0);
  handRoot.add(palmNode);

  // 3. Five Articulated 3-Segment Holographic Fingers (Thumb, Index, Middle, Ring, Pinky)
  const fingerPivots: THREE.Group[] = [];
  const fingerSpecs = [
    { name: 'thumb', x: 0.052 * mirror, z: 0.012, len: 0.032, yaw: 0.48 * mirror },
    { name: 'index', x: 0.034 * mirror, z: -0.052, len: 0.038, yaw: 0.06 * mirror },
    { name: 'middle', x: 0.011 * mirror, z: -0.056, len: 0.042, yaw: 0 },
    { name: 'ring', x: -0.013 * mirror, z: -0.053, len: 0.038, yaw: -0.05 * mirror },
    { name: 'pinky', x: -0.035 * mirror, z: -0.046, len: 0.031, yaw: -0.12 * mirror },
  ];

  const jointSphereGeo = new THREE.OctahedronGeometry(0.0085, 0);

  for (const fSpec of fingerSpecs) {
    const basePivot = new THREE.Group();
    basePivot.position.set(fSpec.x, 0.003, fSpec.z);
    basePivot.rotation.y = fSpec.yaw;

    let parentNode = basePivot;
    for (let seg = 0; seg < 3; seg++) {
      const segLen = fSpec.len * (1 - seg * 0.18);
      const segRadius = 0.0085 * (1 - seg * 0.14);
      const segPivot = new THREE.Group();
      if (seg > 0) {
        segPivot.position.set(0, 0, -fSpec.len * (1 - (seg - 1) * 0.18));
      }

      const knuckle = createHoloPair(jointSphereGeo, 0x38bdf8, 0.75, 1.0);
      segPivot.add(knuckle);

      const boneGeo = new THREE.CylinderGeometry(segRadius * 0.85, segRadius, segLen, 6);
      const bone = createHoloPair(boneGeo, colorHex, 0.5, 0.95);
      bone.rotation.x = Math.PI / 2;
      bone.position.set(0, 0, -segLen * 0.5);
      segPivot.add(bone);

      parentNode.add(segPivot);
      parentNode = segPivot;
    }

    handRoot.add(basePivot);
    fingerPivots.push(basePivot);
  }

  // 4. Index-Finger Tactical Ray Pointer & Pinch Halo
  const pinchHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.016, 0.024, 20),
    new THREE.MeshBasicMaterial({
      color: 0x34d399,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    })
  );
  pinchHalo.position.set(0.025 * mirror, 0.01, -0.15);
  handRoot.add(pinchHalo);

  const rayGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.025 * mirror, 0.005, -0.14),
    new THREE.Vector3(0, 0, -2.6),
  ]);
  const rayMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.78,
  });
  const rayLine = new THREE.Line(rayGeo, rayMat);
  handRoot.add(rayLine);

  let wristWatchBezel: THREE.Group | undefined;
  let wristPanelRoot: THREE.Group | undefined;
  let updateWatchDisplay: VirtualHandRig['updateWatchDisplay'];

  // 5. Mount 3D Chrono-Wristwatch & Floating Adjustable Holographic Wrist Panel on LEFT HAND
  if (side === 'left') {
    wristWatchBezel = new THREE.Group();
    wristWatchBezel.position.set(0.015, 0.036, 0.075);
    handRoot.add(wristWatchBezel);

    // Watch Bezel Ring & Glowing Clickable Dial (Toggles Floating Panel Open/Closed)
    const bezelMesh = createHoloPair(
      new THREE.CylinderGeometry(0.034, 0.038, 0.014, 18),
      0xf59e0b,
      0.7,
      1.0
    );
    wristWatchBezel.add(bezelMesh);

    const chronoRing = createHoloPair(
      new THREE.TorusGeometry(0.038, 0.004, 8, 24),
      0x22d3ee,
      0.85,
      1.0
    );
    chronoRing.rotation.x = Math.PI / 2;
    chronoRing.position.y = 0.009;
    chronoRing.name = 'chrono_ring';
    wristWatchBezel.add(chronoRing);

    const watchDialHit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, 0.02, 16),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
      })
    );
    watchDialHit.position.y = 0.01;
    watchDialHit.userData.watchAction = 'TOGGLE_PANEL' as WristWatchActionId;
    wristWatchBezel.add(watchDialHit);
    interactiveMeshes.push(watchDialHit);

    // Floating Adjustable Holographic Wrist Panel (Projects above the Left Wristwatch!)
    wristPanelRoot = new THREE.Group();
    wristPanelRoot.position.set(0.06, 0.24, 0.02);
    wristPanelRoot.rotation.set(-0.22, -0.18, 0);
    handRoot.add(wristPanelRoot);

    // Projector Cone connecting Watch Face to Floating Panel
    const projBeam = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      })
    );
    projBeam.rotation.x = Math.PI;
    projBeam.position.set(-0.04, -0.12, 0.03);
    wristPanelRoot.add(projBeam);

    // Dynamic 2D Canvas Texture for the 3D Wristwatch Hologram Screen
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 440;
    const ctx = canvas.getContext('2d');
    const canvasTex = new THREE.CanvasTexture(canvas);
    canvasTex.colorSpace = THREE.SRGBColorSpace;
    canvasTex.needsUpdate = true;

    const panelWidth = 0.62;
    const panelHeight = 0.42;

    const screenGeo = new THREE.PlaneGeometry(panelWidth, panelHeight);
    const screenMat = new THREE.MeshBasicMaterial({
      map: canvasTex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    wristPanelRoot.add(screenMesh);

    const frameEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(panelWidth + 0.02, panelHeight + 0.02, 0.012)),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.95 })
    );
    wristPanelRoot.add(frameEdges);

    // Interactive 3D Button Hit-Targets on the Floating Wristwatch Screen
    const add3DWatchButton = (
      action: WristWatchActionId,
      normX: number,
      normY: number,
      normW: number,
      normH: number
    ) => {
      const btnGeo = new THREE.PlaneGeometry(normW * panelWidth, normH * panelHeight);
      const btnMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.01,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const btnMesh = new THREE.Mesh(btnGeo, btnMat);
      btnMesh.position.set(
        (normX - 0.5) * panelWidth,
        (0.5 - normY) * panelHeight,
        0.008
      );
      btnMesh.userData.watchAction = action;
      wristPanelRoot!.add(btnMesh);
      interactiveMeshes.push(btnMesh);
    };

    // Row 1 Header Controls: Pin/Wrist Toggle & Minimize Watch Panel
    add3DWatchButton('TOGGLE_PIN', 0.66, 0.11, 0.24, 0.14);
    add3DWatchButton('TOGGLE_PANEL', 0.89, 0.11, 0.16, 0.14);

    // Row 2 Adjustable Controls: Battle Height (-/+), Panel Scale (-/+), Tilt (-/+)
    add3DWatchButton('HEIGHT_DOWN', 0.14, 0.36, 0.16, 0.15);
    add3DWatchButton('HEIGHT_UP', 0.32, 0.36, 0.16, 0.15);
    add3DWatchButton('SCALE_DOWN', 0.52, 0.36, 0.14, 0.15);
    add3DWatchButton('SCALE_UP', 0.68, 0.36, 0.14, 0.15);
    add3DWatchButton('TILT_LEFT', 0.82, 0.36, 0.1, 0.15);
    add3DWatchButton('TILT_RIGHT', 0.93, 0.36, 0.1, 0.15);

    // Row 3 Quick Fleet Deployment from Wristwatch
    add3DWatchButton('DEPLOY_MINER', 0.16, 0.62, 0.26, 0.18);
    add3DWatchButton('DEPLOY_INTERCEPTOR', 0.45, 0.62, 0.26, 0.18);
    add3DWatchButton('DEPLOY_FRIGATE', 0.74, 0.62, 0.26, 0.18);

    // Row 4 Heavy Command & Tactical Selection
    add3DWatchButton('DEPLOY_CARRIER', 0.18, 0.85, 0.28, 0.18);
    add3DWatchButton('UPGRADE_TIER', 0.5, 0.85, 0.28, 0.18);
    add3DWatchButton('SELECT_COMBAT', 0.82, 0.85, 0.28, 0.18);

    let lastRenderHash = '';
    updateWatchDisplay = (data) => {
      if (!wristPanelRoot || !ctx) return;
      wristPanelRoot.visible = data.open;
      const s = data.panelScale;
      wristPanelRoot.scale.setScalar(s);
      if (!data.pinnedInRoom) {
        wristPanelRoot.rotation.x = -0.22 + THREE.MathUtils.degToRad(data.panelTiltDeg);
      }

      const hash = `${data.open}_${data.pinnedInRoom}_${Math.floor(data.ore)}_${Math.floor(
        data.energy
      )}_T${data.tier}_${data.supplyText}_${data.selectedCount}_${data.battleElevationY.toFixed(
        2
      )}_${data.panelScale.toFixed(2)}_${data.panelTiltDeg}`;
      if (hash === lastRenderHash) return;
      lastRenderHash = hash;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Translucent Dark Obsidian Hologram Backdrop
      ctx.fillStyle = 'rgba(4, 12, 26, 0.92)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

      // Header Bar
      ctx.fillStyle = 'rgba(8, 51, 68, 0.75)';
      ctx.fillRect(8, 8, canvas.width - 16, 68);

      ctx.fillStyle = '#67e8f9';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('CHRONO-WRIST TACTICAL HOLO', 20, 36);

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 17px monospace';
      ctx.fillText(
        `ORE: ${Math.floor(data.ore)}  EN: ${Math.floor(data.energy)}  T${data.tier}  CAP: ${
          data.supplyText
        }`,
        20,
        64
      );

      // Pin & Close Buttons
      ctx.fillStyle = data.pinnedInRoom ? '#f59e0b' : '#0891b2';
      ctx.fillRect(350, 16, 150, 48);
      ctx.fillStyle = '#040812';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(data.pinnedInRoom ? 'PINNED IN ROOM' : 'PIN IN ROOM', 364, 46);

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(514, 16, 108, 48);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(514, 16, 108, 48);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('MINIMIZE', 528, 46);

      // Row 2: Room Level Elevation & Panel Adjusters
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(
        `FLOAT LEVEL Y: ${data.battleElevationY.toFixed(2)}m   SIZE: ${Math.round(
          data.panelScale * 100
        )}%   TILT: ${data.panelTiltDeg}°`,
        20,
        108
      );

      const drawPillBtn = (x: number, y: number, w: number, h: number, label: string, color = '#0e7490') => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(label, x + 12, y + h / 2 + 6);
      };

      drawPillBtn(20, 122, 112, 54, 'LEVEL -');
      drawPillBtn(142, 122, 112, 54, 'LEVEL +');
      drawPillBtn(274, 122, 96, 54, 'SIZE -');
      drawPillBtn(380, 122, 96, 54, 'SIZE +');
      drawPillBtn(490, 122, 60, 54, 'T-');
      drawPillBtn(560, 122, 60, 54, 'T+');

      // Row 3: Wrist Fleet Fabricator
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(
        `SELECTED FLEET: ${data.selectedCount} SHIP(S) · TAP WATCH OR POINT IN ROOM`,
        20,
        212
      );

      drawPillBtn(20, 228, 186, 72, '+ MINER (50)', '#0f766e');
      drawPillBtn(224, 228, 186, 72, '+ DART (65)', '#0369a1');
      drawPillBtn(428, 228, 192, 72, '+ FRIGATE (125)', '#0369a1');

      // Row 4: Capital & Command Actions
      drawPillBtn(20, 322, 186, 82, '+ CARRIER (T3)', '#b45309');
      drawPillBtn(224, 322, 186, 82, 'UPGRADE TIER', '#4f46e5');
      drawPillBtn(428, 322, 192, 82, 'SELECT FLEET', '#047857');

      canvasTex.needsUpdate = true;
    };
  }

  const animatePose = (elapsedSec: number, isPinching: boolean) => {
    fingerPivots.forEach((fp, idx) => {
      const baseCurl = isPinching
        ? idx === 0 || idx === 1
          ? 0.65
          : 0.35
        : 0.14 + Math.sin(elapsedSec * 2.2 + idx * 0.6) * 0.06;
      fp.rotation.x = baseCurl;
      const midSeg = fp.children[0] as THREE.Group | undefined;
      if (midSeg) {
        midSeg.rotation.x = baseCurl * 0.85;
      }
    });

    pinchHalo.scale.setScalar(isPinching ? 1.45 : 0.9 + Math.sin(elapsedSec * 5) * 0.1);
    const chRing = wristWatchBezel?.getObjectByName('chrono_ring');
    if (chRing) {
      chRing.rotation.z = elapsedSec * 0.8;
    }
  };

  return {
    group,
    wristWatchBezel,
    wristPanelRoot,
    interactiveMeshes,
    animatePose,
    updateWatchDisplay,
  };
}

