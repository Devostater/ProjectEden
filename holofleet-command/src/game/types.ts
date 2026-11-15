export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'brutal';

export type ArmyColorId = 'cyan' | 'amber' | 'emerald' | 'rose' | 'violet' | 'gold';

export interface ArmyColorSpec {
  id: ArmyColorId;
  name: string;
  hex: string;
  num: number;
  accentHex: string;
}

export type HeroId = 'valkyrie' | 'aegis' | 'hyperion' | 'nexus';

export interface HeroCommanderSpec {
  id: HeroId;
  name: string;
  title: string;
  passiveDesc: string;
  abilityName: string;
  abilityDesc: string;
  cooldownSec: number;
}

export interface PlayerSlotConfig {
  slotIndex: number; // 0 = Human Player, 1..3 = AI Players
  name: string;
  isHuman: boolean;
  active: boolean;
  difficulty: AIDifficulty;
  team: 1 | 2 | 3 | 4;
  colorId: ArmyColorId;
  heroId: HeroId;
}

export type BaseTier = 1 | 2 | 3;

export type BuildingType =
  | 'refinery'
  | 'sensor_array'
  | 'orbital_shipyard'
  | 'defense_grid'
  | 'titan_foundry';

export interface BuildingSpec {
  type: BuildingType;
  name: string;
  tierRequired: BaseTier;
  costOre: number;
  costEnergy: number;
  description: string;
  unlocksText: string;
  keyHint: string;
}

export type UnitType =
  | 'miner'
  | 'interceptor'
  | 'frigate'
  | 'cruiser'
  | 'carrier'
  | 'micro_drone'
  | 'hero_flagship';

export type BehaviorPolicy =
  | 'harvester'
  | 'swarmer'
  | 'kiter'
  | 'charger'
  | 'carrier_boss'
  | 'orbiter'
  | 'commander';

export interface UnitSpec {
  type: UnitType;
  name: string;
  role: string;
  costOre: number;
  costEnergy: number;
  tierRequired: BaseTier;
  buildingRequired?: BuildingType;
  maxHp: number;
  speed: number;
  range: number;
  damage: number;
  fireRateSec: number;
  policy: BehaviorPolicy;
  scale: number;
  supplyCost: number;
  keyHint?: string;
}

export type TacticalStance = 'attack' | 'defend' | 'focus_carriers' | 'harvest';

export type VoiceCommandIntent =
  | 'ALL_ATTACK'
  | 'DEFEND_BASE'
  | 'FOCUS_CARRIERS'
  | 'HARVEST_BOOST'
  | 'DEPLOY_CARRIER'
  | 'HERO_ABILITY'
  | 'PASSTHROUGH_CALIBRATE';

export interface FactionState {
  slotIndex: number;
  name: string;
  isHuman: boolean;
  difficulty: AIDifficulty;
  team: 1 | 2 | 3 | 4;
  colorId: ArmyColorId;
  heroId: HeroId;
  baseTier: BaseTier;
  baseHp: number;
  maxBaseHp: number;
  baseShield: number;
  maxBaseShield: number;
  ore: number;
  energy: number;
  supplyUsed: number;
  supplyCap: number;
  buildings: BuildingType[];
  stance: TacticalStance;
  heroCooldown: number;
  heroActiveTimer: number;
  position: { x: number; y: number; z: number };
  defeated: boolean;
  aiActionTimer: number;
  kills: number;
  oreMinedTotal: number;
}

export interface UnitEntity {
  id: string;
  ownerSlot: number;
  team: 1 | 2 | 3 | 4;
  type: UnitType;
  policy: BehaviorPolicy;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotationY: number;
  targetId: string | null;
  attackCooldown: number;
  carrierSpawnTimer: number;
  miningLoad: number;
  hitFlashTimer: number;
  koTimer: number; // > 0 when dying topple/dissolve is active
  selected?: boolean;
  manualMoveTarget?: { x: number; z: number } | null;
  manualAttackTargetId?: string | null;
  manualStationTargetSlot?: number | null;
  manualAsteroidTargetId?: string | null;
  orderLabel?: string;
}

export interface SelectedUnitInfo {
  id: string;
  type: UnitType;
  name: string;
  hp: number;
  maxHp: number;
  orderLabel: string;
}

export interface AsteroidEntity {
  id: string;
  stationSlot: number; // 0..3: which station this 5-asteroid cluster belongs to
  x: number;
  y: number;
  z: number;
  radius: number;
  oreRemaining: number;
  maxOre: number;
  rotationSpeed: number;
}

export interface LaserBeamEvent {
  id: string;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  colorHex: number;
  width: number;
  ttl: number;
  maxTtl: number;
  isMining?: boolean;
  isHeavy?: boolean;
}

export interface HapticPulseEvent {
  id: string;
  intensity: number; // 0.1 to 1.0
  durationMs: number;
  label: string;
  timestamp: number;
}

export interface RunSummarySnapshot {
  victory: boolean;
  winnerName: string;
  winnerTeam: number;
  clearTimeSec: number;
  score: number;
  bestScore: number;
  hostilesDestroyed: number;
  oreMined: number;
  maxTierReached: BaseTier;
  carriersDeployed: number;
}

export type RoomVantageAngle =
  | 'south_sofa'
  | 'east_credenza'
  | 'north_tv'
  | 'west_shelf'
  | 'center_walk'
  | 'overhead';

export interface WristWatchPanelState {
  open: boolean;
  pinnedInRoom: boolean;
  panelScale: number;
  panelTiltDeg: number;
  battleElevationY: number;
  roomBoundaryScale: number;
  activeVantage: RoomVantageAngle;
}

