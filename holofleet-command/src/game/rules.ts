import {
  AIDifficulty,
  ArmyColorId,
  ArmyColorSpec,
  AsteroidEntity,
  BaseTier,
  BuildingSpec,
  BuildingType,
  FactionState,
  HeroCommanderSpec,
  HeroId,
  PlayerSlotConfig,
  UnitEntity,
  UnitSpec,
  UnitType,
  VoiceCommandIntent,
} from './types';

export const ARMY_COLORS: Record<ArmyColorId, ArmyColorSpec> = {
  cyan: {
    id: 'cyan',
    name: 'Aether Cyan',
    hex: '#06B6D4',
    num: 0x06b6d4,
    accentHex: '#67E8F9',
  },
  amber: {
    id: 'amber',
    name: 'Solar Amber',
    hex: '#F59E0B',
    num: 0xf59e0b,
    accentHex: '#FDE68A',
  },
  emerald: {
    id: 'emerald',
    name: 'Xenon Emerald',
    hex: '#10B981',
    num: 0x10b981,
    accentHex: '#6EE7B7',
  },
  rose: {
    id: 'rose',
    name: 'Crimson Nova',
    hex: '#F43F5E',
    num: 0xf43f5e,
    accentHex: '#FDA4AF',
  },
  violet: {
    id: 'violet',
    name: 'Void Violet',
    hex: '#8B5CF6',
    num: 0x8b5cf6,
    accentHex: '#C4B5FD',
  },
  gold: {
    id: 'gold',
    name: 'Imperial Gold',
    hex: '#EAB308',
    num: 0xeab308,
    accentHex: '#FEF08A',
  },
};

export const HERO_COMMANDERS: Record<HeroId, HeroCommanderSpec> = {
  valkyrie: {
    id: 'valkyrie',
    name: 'Commander Valkyrie-7',
    title: 'Strike Wing Tactician',
    passiveDesc: '+20% Interceptor & Drone laser fire rate',
    abilityName: 'Overdrive Barrage',
    abilityDesc: 'Boosts all friendly ship speed & fire rate by +60% for 10s and deploys 2 Escort Interceptors.',
    cooldownSec: 24,
  },
  aegis: {
    id: 'aegis',
    name: 'Archon Aegis Prime',
    title: 'Bastion Orbital Architect',
    passiveDesc: '+30% Base Station shield capacity & regeneration',
    abilityName: 'Phase Bulwark',
    abilityDesc: 'Instantly restores +350 Station Shield, repairs friendly hulls by 25%, and fires an orbital EMP pulse.',
    cooldownSec: 26,
  },
  hyperion: {
    id: 'hyperion',
    name: 'Admiral Hyperion-X',
    title: 'Dreadnought Carrier Lord',
    passiveDesc: 'Titan Carriers deploy +2 extra Micro-Drones per wave',
    abilityName: 'Swarm Protocol',
    abilityDesc: 'Immediately launches 6 holographic Micro-Drones from your Station and each active Titan Carrier.',
    cooldownSec: 28,
  },
  nexus: {
    id: 'nexus',
    name: 'Prospector Nexus Zero',
    title: 'Deep-Core Astro Engineer',
    passiveDesc: '+30% Asteroid mining yield & +5 passive Energy/sec',
    abilityName: 'Quantum Harvest',
    abilityDesc: 'Extracts +260 Ore and +150 Energy immediately while supercharging mining beams.',
    cooldownSec: 22,
  },
};

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  refinery: {
    type: 'refinery',
    name: 'Ore Refinery',
    tierRequired: 1,
    costOre: 90,
    costEnergy: 25,
    description: 'Boosts Miner Drone yield by +35% and generates +5 Ore/s.',
    unlocksText: 'Required for Base Tier 2',
    keyHint: '1',
  },
  sensor_array: {
    type: 'sensor_array',
    name: 'Tactical Sensor Array',
    tierRequired: 1,
    costOre: 110,
    costEnergy: 40,
    description: 'Projects living-room spatial radar & generates +6 Energy/s.',
    unlocksText: 'Required for Base Tier 2',
    keyHint: '2',
  },
  orbital_shipyard: {
    type: 'orbital_shipyard',
    name: 'Orbital Shipyard',
    tierRequired: 2,
    costOre: 160,
    costEnergy: 80,
    description: 'Heavy holographic drydock for Pulse Frigates & Siege Cruisers.',
    unlocksText: 'Unlocks Frigate, Cruiser & Tier 3 path',
    keyHint: '3',
  },
  defense_grid: {
    type: 'defense_grid',
    name: 'Furniture Laser Grid',
    tierRequired: 2,
    costOre: 140,
    costEnergy: 70,
    description: 'Anchors automated twin laser turrets onto room furniture perimeters.',
    unlocksText: 'Required for Base Tier 3',
    keyHint: '4',
  },
  titan_foundry: {
    type: 'titan_foundry',
    name: 'Titan Carrier Foundry',
    tierRequired: 3,
    costOre: 280,
    costEnergy: 150,
    description: 'Capital warp gantry capable of assembling Leviathan Titan Carriers.',
    unlocksText: 'Unlocks Game-Ending Titan Carrier',
    keyHint: '5',
  },
};

export const MAP_HALF_EXTENT = 20.0; // 40m x 40m playable sector inside 44m x 44m grand arena

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  miner: {
    type: 'miner',
    name: 'Astro Miner Drone',
    role: 'Resource Harvester · Autonomous Ore Beam',
    costOre: 50,
    costEnergy: 10,
    tierRequired: 1,
    maxHp: 110,
    speed: 1.15,
    range: 3.4,
    damage: 4,
    fireRateSec: 0.6,
    policy: 'harvester',
    scale: 0.46,
    supplyCost: 1,
    keyHint: 'Q',
  },
  interceptor: {
    type: 'interceptor',
    name: 'Dart Interceptor',
    role: 'Fast Swarmer · Rapid Twin Pew-Pew Lasers',
    costOre: 65,
    costEnergy: 20,
    tierRequired: 1,
    maxHp: 125,
    speed: 1.65,
    range: 6.2,
    damage: 14,
    fireRateSec: 0.34,
    policy: 'swarmer',
    scale: 0.52,
    supplyCost: 1,
    keyHint: 'W',
  },
  frigate: {
    type: 'frigate',
    name: 'Pulse Frigate',
    role: 'Ranged Kiter · Dual Phase Plasma Bolts',
    costOre: 125,
    costEnergy: 55,
    tierRequired: 2,
    buildingRequired: 'orbital_shipyard',
    maxHp: 290,
    speed: 1.2,
    range: 9.2,
    damage: 30,
    fireRateSec: 0.58,
    policy: 'kiter',
    scale: 0.78,
    supplyCost: 2,
    keyHint: 'E',
  },
  cruiser: {
    type: 'cruiser',
    name: 'Aegis Siege Cruiser',
    role: 'Armored Linebreaker · Heavy Ion Cannon',
    costOre: 200,
    costEnergy: 95,
    tierRequired: 2,
    buildingRequired: 'orbital_shipyard',
    maxHp: 580,
    speed: 0.88,
    range: 10.8,
    damage: 58,
    fireRateSec: 0.78,
    policy: 'charger',
    scale: 1.05,
    supplyCost: 3,
    keyHint: 'R',
  },
  carrier: {
    type: 'carrier',
    name: 'Leviathan Titan Carrier',
    role: 'Game-Ending Capital Ship · Spawns Swarm Drones',
    costOre: 380,
    costEnergy: 200,
    tierRequired: 3,
    buildingRequired: 'titan_foundry',
    maxHp: 1650,
    speed: 0.55,
    range: 13.5,
    damage: 95,
    fireRateSec: 0.68,
    policy: 'carrier_boss',
    scale: 1.75,
    supplyCost: 6,
    keyHint: 'T',
  },
  micro_drone: {
    type: 'micro_drone',
    name: 'Carrier Micro-Drone',
    role: 'Autonomous Swarm Fighter · High-RoF Lasers',
    costOre: 0,
    costEnergy: 0,
    tierRequired: 1,
    maxHp: 60,
    speed: 2.15,
    range: 5.5,
    damage: 9,
    fireRateSec: 0.24,
    policy: 'orbiter',
    scale: 0.3,
    supplyCost: 0,
  },
  hero_flagship: {
    type: 'hero_flagship',
    name: 'Commander Flagship',
    role: 'Hero Command Vessel · Fleet Aura & Superlaser',
    costOre: 180,
    costEnergy: 100,
    tierRequired: 1,
    maxHp: 740,
    speed: 1.3,
    range: 10.5,
    damage: 52,
    fireRateSec: 0.42,
    policy: 'commander',
    scale: 1.15,
    supplyCost: 2,
    keyHint: 'Y',
  },
};

export const BASE_TIER_UPGRADE_RULES: Record<
  2 | 3,
  {
    targetTier: 2 | 3;
    name: string;
    costOre: number;
    costEnergy: number;
    requiredBuildings: BuildingType[];
    hpBonus: number;
    shieldBonus: number;
    supplyBonus: number;
  }
> = {
  2: {
    targetTier: 2,
    name: 'Tier 2: Command Citadel',
    costOre: 220,
    costEnergy: 100,
    requiredBuildings: ['refinery', 'sensor_array'],
    hpBonus: 700,
    shieldBonus: 350,
    supplyBonus: 14,
  },
  3: {
    targetTier: 3,
    name: 'Tier 3: Starlight Dreadnought Bastion',
    costOre: 400,
    costEnergy: 220,
    requiredBuildings: ['orbital_shipyard', 'defense_grid'],
    hpBonus: 1200,
    shieldBonus: 650,
    supplyBonus: 22,
  },
};

export const AI_DIFFICULTY_MULTIPLIERS: Record<
  AIDifficulty,
  {
    resourceRateMult: number;
    decisionIntervalSec: number;
    damageMult: number;
    aggressionBias: number;
  }
> = {
  easy: {
    resourceRateMult: 0.75,
    decisionIntervalSec: 4.5,
    damageMult: 0.8,
    aggressionBias: 0.35,
  },
  medium: {
    resourceRateMult: 1.0,
    decisionIntervalSec: 3.0,
    damageMult: 1.0,
    aggressionBias: 0.55,
  },
  hard: {
    resourceRateMult: 1.35,
    decisionIntervalSec: 2.0,
    damageMult: 1.15,
    aggressionBias: 0.75,
  },
  brutal: {
    resourceRateMult: 1.75,
    decisionIntervalSec: 1.25,
    damageMult: 1.3,
    aggressionBias: 0.92,
  },
};

export const DEFAULT_PLAYER_SLOTS: PlayerSlotConfig[] = [
  {
    slotIndex: 0,
    name: 'Player 1 (Living Room HQ)',
    isHuman: true,
    active: true,
    difficulty: 'medium',
    team: 1,
    colorId: 'cyan',
    heroId: 'valkyrie',
  },
  {
    slotIndex: 1,
    name: 'Xenon Hive AI-Alpha',
    isHuman: false,
    active: true,
    difficulty: 'medium',
    team: 2,
    colorId: 'rose',
    heroId: 'hyperion',
  },
  {
    slotIndex: 2,
    name: 'Solaris Syndicate AI-Beta',
    isHuman: false,
    active: true,
    difficulty: 'hard',
    team: 3,
    colorId: 'amber',
    heroId: 'aegis',
  },
  {
    slotIndex: 3,
    name: 'Emerald Vanguards AI-Gamma',
    isHuman: false,
    active: false,
    difficulty: 'easy',
    team: 4,
    colorId: 'emerald',
    heroId: 'nexus',
  },
];

// Large Sector Map Station Anchor Coordinates (44m x 44m Grand Desktop / XR Arena)
export const STATION_SPAWN_POSITIONS: Array<{ x: number; y: number; z: number }> = [
  { x: 0, y: 1.15, z: 15.5 },    // Slot 0: South (Player sofa side)
  { x: 0, y: 1.25, z: -15.5 },   // Slot 1: North (Opposite media wall)
  { x: -15.5, y: 1.2, z: 0 },    // Slot 2: West (Bookshelf flank)
  { x: 15.5, y: 1.2, z: 0 },     // Slot 3: East (Credenza flank)
];

export function canBuildStructure(
  faction: FactionState,
  buildingType: BuildingType
): { allowed: boolean; reason?: string } {
  const spec = BUILDING_SPECS[buildingType];
  if (faction.defeated) {
    return { allowed: false, reason: 'Base station destroyed' };
  }
  if (faction.buildings.includes(buildingType)) {
    return { allowed: false, reason: 'Already constructed' };
  }
  if (faction.baseTier < spec.tierRequired) {
    return {
      allowed: false,
      reason: `Requires Base Tier ${spec.tierRequired}`,
    };
  }
  if (faction.ore < spec.costOre) {
    return {
      allowed: false,
      reason: `Need ${spec.costOre} Ore (have ${Math.floor(faction.ore)})`,
    };
  }
  if (faction.energy < spec.costEnergy) {
    return {
      allowed: false,
      reason: `Need ${spec.costEnergy} Energy (have ${Math.floor(faction.energy)})`,
    };
  }
  return { allowed: true };
}

export function constructStructure(
  faction: FactionState,
  buildingType: BuildingType
): FactionState {
  const check = canBuildStructure(faction, buildingType);
  if (!check.allowed) return faction;
  const spec = BUILDING_SPECS[buildingType];
  return {
    ...faction,
    ore: faction.ore - spec.costOre,
    energy: faction.energy - spec.costEnergy,
    buildings: [...faction.buildings, buildingType],
  };
}

export function canUpgradeBaseTier(
  faction: FactionState
): { allowed: boolean; nextTier?: 2 | 3; reason?: string } {
  if (faction.defeated) {
    return { allowed: false, reason: 'Station offline' };
  }
  if (faction.baseTier >= 3) {
    return { allowed: false, reason: 'Maximum Tier 3 reached' };
  }
  const nextTier: 2 | 3 = faction.baseTier === 1 ? 2 : 3;
  const rule = BASE_TIER_UPGRADE_RULES[nextTier];

  const missingBuildings = rule.requiredBuildings.filter(
    (b) => !faction.buildings.includes(b)
  );
  if (missingBuildings.length > 0) {
    const names = missingBuildings.map((b) => BUILDING_SPECS[b].name).join(' & ');
    return {
      allowed: false,
      nextTier,
      reason: `Requires: ${names}`,
    };
  }
  if (faction.ore < rule.costOre) {
    return {
      allowed: false,
      nextTier,
      reason: `Need ${rule.costOre} Ore`,
    };
  }
  if (faction.energy < rule.costEnergy) {
    return {
      allowed: false,
      nextTier,
      reason: `Need ${rule.costEnergy} Energy`,
    };
  }
  return { allowed: true, nextTier };
}

export function upgradeBaseTier(faction: FactionState): FactionState {
  const check = canUpgradeBaseTier(faction);
  if (!check.allowed || !check.nextTier) return faction;
  const rule = BASE_TIER_UPGRADE_RULES[check.nextTier];
  return {
    ...faction,
    baseTier: check.nextTier,
    ore: faction.ore - rule.costOre,
    energy: faction.energy - rule.costEnergy,
    maxBaseHp: faction.maxBaseHp + rule.hpBonus,
    baseHp: faction.baseHp + rule.hpBonus,
    maxBaseShield: faction.maxBaseShield + rule.shieldBonus,
    baseShield: faction.baseShield + rule.shieldBonus,
    supplyCap: faction.supplyCap + rule.supplyBonus,
  };
}

export function canDeployUnit(
  faction: FactionState,
  unitType: UnitType
): { allowed: boolean; reason?: string } {
  const spec = UNIT_SPECS[unitType];
  if (faction.defeated) {
    return { allowed: false, reason: 'Station offline' };
  }
  if (faction.baseTier < spec.tierRequired) {
    return {
      allowed: false,
      reason: `Requires Base Tier ${spec.tierRequired}`,
    };
  }
  if (spec.buildingRequired && !faction.buildings.includes(spec.buildingRequired)) {
    return {
      allowed: false,
      reason: `Requires ${BUILDING_SPECS[spec.buildingRequired].name}`,
    };
  }
  if (faction.supplyUsed + spec.supplyCost > faction.supplyCap) {
    return {
      allowed: false,
      reason: `Fleet cap full (${faction.supplyUsed}/${faction.supplyCap})`,
    };
  }
  if (faction.ore < spec.costOre) {
    return {
      allowed: false,
      reason: `Need ${spec.costOre} Ore`,
    };
  }
  if (faction.energy < spec.costEnergy) {
    return {
      allowed: false,
      reason: `Need ${spec.costEnergy} Energy`,
    };
  }
  return { allowed: true };
}

export function parseVoiceTranscriptToCommand(
  transcript: string
): VoiceCommandIntent | null {
  const clean = transcript.trim().toLowerCase();
  if (!clean) return null;

  if (
    clean.includes('carrier') ||
    clean.includes('titan') ||
    clean.includes('dreadnought') ||
    clean.includes('capital')
  ) {
    if (clean.includes('focus') || clean.includes('target') || clean.includes('destroy')) {
      return 'FOCUS_CARRIERS';
    }
    return 'DEPLOY_CARRIER';
  }
  if (
    clean.includes('hero') ||
    clean.includes('overdrive') ||
    clean.includes('ability') ||
    clean.includes('commander') ||
    clean.includes('ult')
  ) {
    return 'HERO_ABILITY';
  }
  if (
    clean.includes('defend') ||
    clean.includes('recall') ||
    clean.includes('retreat') ||
    clean.includes('shield') ||
    clean.includes('protect')
  ) {
    return 'DEFEND_BASE';
  }
  if (
    clean.includes('mine') ||
    clean.includes('asteroid') ||
    clean.includes('harvest') ||
    clean.includes('ore')
  ) {
    return 'HARVEST_BOOST';
  }
  if (
    clean.includes('passthrough') ||
    clean.includes('furniture') ||
    clean.includes('calibrate') ||
    clean.includes('room')
  ) {
    return 'PASSTHROUGH_CALIBRATE';
  }
  if (
    clean.includes('attack') ||
    clean.includes('engage') ||
    clean.includes('charge') ||
    clean.includes('all units') ||
    clean.includes('pew')
  ) {
    return 'ALL_ATTACK';
  }
  return null;
}

export function createInitialFactions(slots: PlayerSlotConfig[]): FactionState[] {
  const activeSlots = slots.filter((s) => s.active || s.isHuman);
  return activeSlots.map((slot) => {
    const pos =
      STATION_SPAWN_POSITIONS[slot.slotIndex] ?? STATION_SPAWN_POSITIONS[0];
    const isAegis = slot.heroId === 'aegis';
    const baseShield = isAegis ? 460 : 350;
    return {
      slotIndex: slot.slotIndex,
      name: slot.name,
      isHuman: slot.isHuman,
      difficulty: slot.difficulty,
      team: slot.team,
      colorId: slot.colorId,
      heroId: slot.heroId,
      baseTier: 1,
      baseHp: 1100,
      maxBaseHp: 1100,
      baseShield,
      maxBaseShield: baseShield,
      ore: 260,
      energy: 140,
      supplyUsed: 4,
      supplyCap: 18,
      buildings: [],
      stance: 'attack',
      heroCooldown: 0,
      heroActiveTimer: 0,
      position: { ...pos },
      defeated: false,
      aiActionTimer: 2.0,
      kills: 0,
      oreMinedTotal: 0,
    };
  });
}

/**
 * Places 5 dedicated Ore Asteroids in a crescent arc near EACH of the 4 stations (20 total)
 */
export function createInitialAsteroids(): AsteroidEntity[] {
  const asteroids: AsteroidEntity[] = [];
  const arcRadius = 4.2;
  const arcAngles = [-0.95, -0.48, 0, 0.48, 0.95]; // 5 asteroids per station

  STATION_SPAWN_POSITIONS.forEach((stationPos, slotIndex) => {
    // Base angle pointing from station toward map center (0, 0)
    const inwardAngle = Math.atan2(-stationPos.x, -stationPos.z);

    arcAngles.forEach((offsetAngle, idx) => {
      const angle = inwardAngle + offsetAngle;
      const dist = arcRadius + (idx % 2 === 0 ? 0.35 : -0.25);
      const ax = Number((stationPos.x + Math.sin(angle) * dist).toFixed(2));
      const az = Number((stationPos.z + Math.cos(angle) * dist).toFixed(2));
      const ay = Number((1.05 + (idx % 3) * 0.18).toFixed(2));
      const r = idx === 2 ? 0.62 : 0.48 + (idx % 2) * 0.06;
      const ore = idx === 2 ? 1500 : 1150;

      asteroids.push({
        id: `ast_s${slotIndex}_${idx}`,
        stationSlot: slotIndex,
        x: ax,
        y: ay,
        z: az,
        radius: r,
        oreRemaining: ore,
        maxOre: ore,
        rotationSpeed: 0.22 + ((slotIndex + idx) % 4) * 0.1,
      });
    });
  });

  return asteroids;
}

/**
 * Pure helper to assign a direct Move order to all currently selected friendly units
 */
export function issueMoveOrderToUnits(
  units: UnitEntity[],
  targetX: number,
  targetZ: number
): number {
  let orderedCount = 0;
  const clampedX = Math.max(-MAP_HALF_EXTENT + 1, Math.min(MAP_HALF_EXTENT - 1, targetX));
  const clampedZ = Math.max(-MAP_HALF_EXTENT + 1, Math.min(MAP_HALF_EXTENT - 1, targetZ));

  const selectedList = units.filter((u) => u.selected && u.koTimer === 0);
  selectedList.forEach((u, idx) => {
    // Formation spread offset when multiple units are selected
    const row = Math.floor(idx / 3);
    const col = (idx % 3) - 1;
    const offsetX = selectedList.length > 1 ? col * 1.1 : 0;
    const offsetZ = selectedList.length > 1 ? row * 1.1 : 0;

    u.manualMoveTarget = {
      x: clampedX + offsetX,
      z: clampedZ + offsetZ,
    };
    u.manualAttackTargetId = null;
    u.manualStationTargetSlot = null;
    u.manualAsteroidTargetId = null;
    u.orderLabel = `Moving to (${Math.round(clampedX)}, ${Math.round(clampedZ)})`;
    orderedCount++;
  });
  return orderedCount;
}

/**
 * Pure helper to assign a direct Attack Target or Asteroid Harvest order to selected units
 */
export function issueTargetOrderToUnits(
  units: UnitEntity[],
  options: {
    enemyUnitId?: string;
    enemyUnitName?: string;
    enemyStationSlot?: number;
    enemyStationName?: string;
    asteroidId?: string;
  }
): number {
  let orderedCount = 0;
  for (const u of units) {
    if (!u.selected || u.koTimer > 0) continue;
    u.manualMoveTarget = null;
    if (options.enemyUnitId) {
      u.manualAttackTargetId = options.enemyUnitId;
      u.manualStationTargetSlot = null;
      u.manualAsteroidTargetId = null;
      u.orderLabel = `Attacking ${options.enemyUnitName ?? 'Hostile Ship'}`;
      orderedCount++;
    } else if (typeof options.enemyStationSlot === 'number') {
      u.manualAttackTargetId = null;
      u.manualStationTargetSlot = options.enemyStationSlot;
      u.manualAsteroidTargetId = null;
      u.orderLabel = `Sieging ${options.enemyStationName ?? 'Enemy Station'}`;
      orderedCount++;
    } else if (options.asteroidId) {
      u.manualAttackTargetId = null;
      u.manualStationTargetSlot = null;
      u.manualAsteroidTargetId = options.asteroidId;
      u.orderLabel = 'Mining Target Asteroid';
      orderedCount++;
    }
  }
  return orderedCount;
}

export function evaluateMatchOutcome(factions: FactionState[]): {
  finished: boolean;
  winningTeam: number | null;
  humanVictory: boolean;
} {
  const human = factions.find((f) => f.isHuman);
  if (human && human.defeated) {
    const aliveEnemy = factions.find((f) => !f.defeated && f.team !== human.team);
    return {
      finished: true,
      winningTeam: aliveEnemy ? aliveEnemy.team : null,
      humanVictory: false,
    };
  }

  const aliveTeams = new Set<number>();
  for (const f of factions) {
    if (!f.defeated) {
      aliveTeams.add(f.team);
    }
  }

  if (aliveTeams.size <= 1 && factions.length > 1) {
    const winningTeam = aliveTeams.values().next().value ?? null;
    return {
      finished: true,
      winningTeam,
      humanVictory: human ? winningTeam === human.team : false,
    };
  }

  return {
    finished: false,
    winningTeam: null,
    humanVictory: false,
  };
}

export function calculateMatchScore(faction: FactionState, clearTimeSec: number): number {
  const killPoints = faction.kills * 120;
  const orePoints = Math.round(faction.oreMinedTotal * 1.5);
  const tierBonus = faction.baseTier * 500;
  const buildingBonus = faction.buildings.length * 250;
  const speedBonus = faction.defeated
    ? 0
    : Math.max(0, Math.round((420 - clearTimeSec) * 4));
  return killPoints + orePoints + tierBonus + buildingBonus + speedBonus;
}

export interface RoomVantageSpec {
  id: 'south_sofa' | 'east_credenza' | 'north_tv' | 'west_shelf' | 'center_walk' | 'overhead';
  label: string;
  shortLabel: string;
  camX: number;
  camY: number;
  camZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export const ROOM_VANTAGE_PRESETS: Record<RoomVantageSpec['id'], RoomVantageSpec> = {
  south_sofa: {
    id: 'south_sofa',
    label: 'South Sofa Side (Player HQ)',
    shortLabel: 'South Sofa',
    camX: 0,
    camY: 16.5,
    camZ: 24.5,
    targetX: 0,
    targetY: 2.2,
    targetZ: 2.0,
  },
  east_credenza: {
    id: 'east_credenza',
    label: 'East Credenza Flank (90°)',
    shortLabel: 'East Wall',
    camX: 24.5,
    camY: 14.5,
    camZ: 0,
    targetX: 0,
    targetY: 2.2,
    targetZ: 0,
  },
  north_tv: {
    id: 'north_tv',
    label: 'North Media Wall (180° Reverse)',
    shortLabel: 'North TV',
    camX: 0,
    camY: 15.5,
    camZ: -24.5,
    targetX: 0,
    targetY: 2.2,
    targetZ: -2.0,
  },
  west_shelf: {
    id: 'west_shelf',
    label: 'West Bookshelf Flank (270°)',
    shortLabel: 'West Shelf',
    camX: -24.5,
    camY: 14.5,
    camZ: 0,
    targetX: 0,
    targetY: 2.2,
    targetZ: 0,
  },
  center_walk: {
    id: 'center_walk',
    label: 'Living Room Eye-Level Walk-In',
    shortLabel: 'Room Eye-Level',
    camX: 0,
    camY: 6.2,
    camZ: 12.8,
    targetX: 0,
    targetY: 2.4,
    targetZ: -3.5,
  },
  overhead: {
    id: 'overhead',
    label: 'Full Living Room Boundary Top-Down',
    shortLabel: 'Overhead',
    camX: 0,
    camY: 36.0,
    camZ: 6.0,
    targetX: 0,
    targetY: 2.0,
    targetZ: 0,
  },
};

/**
 * Pure helper converting world coordinates on the floating living-room holotable into arena coordinates
 */
export function mapRoomWorldToArenaCoords(
  worldX: number,
  worldZ: number,
  roomBoundaryScale: number
): { x: number; z: number } {
  const safeScale = Math.max(0.05, roomBoundaryScale);
  const localX = worldX / safeScale;
  const localZ = worldZ / safeScale;
  return {
    x: Math.max(-MAP_HALF_EXTENT, Math.min(MAP_HALF_EXTENT, localX)),
    z: Math.max(-MAP_HALF_EXTENT, Math.min(MAP_HALF_EXTENT, localZ)),
  };
}

