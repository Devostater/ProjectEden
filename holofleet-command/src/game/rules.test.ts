import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canBuildStructure,
  constructStructure,
  canUpgradeBaseTier,
  upgradeBaseTier,
  canDeployUnit,
  parseVoiceTranscriptToCommand,
  createInitialFactions,
  createInitialAsteroids,
  issueMoveOrderToUnits,
  issueTargetOrderToUnits,
  evaluateMatchOutcome,
  calculateMatchScore,
  DEFAULT_PLAYER_SLOTS,
  UNIT_SPECS,
  MAP_HALF_EXTENT,
  ROOM_VANTAGE_PRESETS,
  mapRoomWorldToArenaCoords,
} from './rules';
import { UnitEntity } from './types';

test('Base Tier 1 -> 2 -> 3 progression enforces building requirements and resource costs', () => {
  const factions = createInitialFactions(DEFAULT_PLAYER_SLOTS);
  let human = { ...factions[0], ore: 2000, energy: 1000 };

  const checkBefore = canUpgradeBaseTier(human);
  assert.equal(checkBefore.allowed, false);
  assert.ok(checkBefore.reason?.includes('Ore Refinery'));

  human = constructStructure(human, 'refinery');
  human = constructStructure(human, 'sensor_array');
  assert.equal(human.buildings.length, 2);

  const checkTier2 = canUpgradeBaseTier(human);
  assert.equal(checkTier2.allowed, true);
  assert.equal(checkTier2.nextTier, 2);

  human = upgradeBaseTier(human);
  assert.equal(human.baseTier, 2);

  const checkBeforeT3 = canUpgradeBaseTier(human);
  assert.equal(checkBeforeT3.allowed, false);

  human = constructStructure(human, 'orbital_shipyard');
  human = constructStructure(human, 'defense_grid');

  const checkTier3 = canUpgradeBaseTier(human);
  assert.equal(checkTier3.allowed, true);
  assert.equal(checkTier3.nextTier, 3);

  human = upgradeBaseTier(human);
  assert.equal(human.baseTier, 3);
});

test('Titan Carrier deployment requires Tier 3 and Titan Carrier Foundry', () => {
  const factions = createInitialFactions(DEFAULT_PLAYER_SLOTS);
  let human = { ...factions[0], ore: 5000, energy: 5000, supplyCap: 40 };

  assert.equal(canDeployUnit(human, 'carrier').allowed, false);

  human.baseTier = 3;
  const withoutFoundry = canDeployUnit(human, 'carrier');
  assert.equal(withoutFoundry.allowed, false);
  assert.ok(withoutFoundry.reason?.includes('Titan Carrier Foundry'));

  human = constructStructure(human, 'titan_foundry');
  assert.equal(canDeployUnit(human, 'carrier').allowed, true);
});

test('Voice command natural-language parser maps tactical phrases accurately', () => {
  assert.equal(parseVoiceTranscriptToCommand('all units attack now'), 'ALL_ATTACK');
  assert.equal(parseVoiceTranscriptToCommand('focus hostile carriers'), 'FOCUS_CARRIERS');
  assert.equal(parseVoiceTranscriptToCommand('deploy titan carrier'), 'DEPLOY_CARRIER');
  assert.equal(parseVoiceTranscriptToCommand('defend the base station'), 'DEFEND_BASE');
  assert.equal(parseVoiceTranscriptToCommand('mine asteroids for ore'), 'HARVEST_BOOST');
  assert.equal(parseVoiceTranscriptToCommand('activate hero overdrive'), 'HERO_ABILITY');
  assert.equal(parseVoiceTranscriptToCommand('calibrate furniture passthrough'), 'PASSTHROUGH_CALIBRATE');
  assert.equal(parseVoiceTranscriptToCommand(''), null);
});

test('Each station has 5 dedicated ore asteroids (20 total) and ships use dramatic slower speeds on larger map', () => {
  assert.equal(MAP_HALF_EXTENT, 20);
  assert.ok(UNIT_SPECS.carrier.speed <= 0.65);
  assert.ok(UNIT_SPECS.interceptor.speed <= 1.8);
  assert.ok(UNIT_SPECS.miner.speed <= 1.3);

  const asteroids = createInitialAsteroids();
  assert.equal(asteroids.length, 20);

  for (let slot = 0; slot < 4; slot++) {
    const stationCluster = asteroids.filter((a) => a.stationSlot === slot);
    assert.equal(stationCluster.length, 5);
  }
});

test('Direct unit selection and move/attack target orders assign coordinates and target IDs accurately', () => {
  const mockUnits: UnitEntity[] = [
    {
      id: 'u1',
      ownerSlot: 0,
      team: 1,
      type: 'interceptor',
      policy: 'swarmer',
      hp: 100,
      maxHp: 100,
      x: 0,
      y: 1,
      z: 10,
      vx: 0,
      vy: 0,
      vz: 0,
      rotationY: 0,
      targetId: null,
      attackCooldown: 0,
      carrierSpawnTimer: 0,
      miningLoad: 0,
      hitFlashTimer: 0,
      koTimer: 0,
      selected: true,
    },
  ];

  const moveCount = issueMoveOrderToUnits(mockUnits, -6.5, 4.2);
  assert.equal(moveCount, 1);
  assert.deepEqual(mockUnits[0].manualMoveTarget, { x: -6.5, z: 4.2 });
  assert.equal(mockUnits[0].manualAttackTargetId, null);

  const atkCount = issueTargetOrderToUnits(mockUnits, {
    enemyUnitId: 'hostile_99',
    enemyUnitName: 'Xenon Carrier',
  });
  assert.equal(atkCount, 1);
  assert.equal(mockUnits[0].manualAttackTargetId, 'hostile_99');
  assert.equal(mockUnits[0].manualMoveTarget, null);
  assert.ok(mockUnits[0].orderLabel?.includes('Xenon Carrier'));
});

test('Match outcome and scoring evaluate multi-team victory and defeat accurately', () => {
  const factions = createInitialFactions(DEFAULT_PLAYER_SLOTS);
  assert.equal(evaluateMatchOutcome(factions).finished, false);

  const wonFactions = factions.map((f) =>
    f.isHuman ? { ...f, kills: 15, oreMinedTotal: 800, baseTier: 3 as const } : { ...f, defeated: true }
  );
  const outcome = evaluateMatchOutcome(wonFactions);
  assert.equal(outcome.finished, true);
  assert.equal(outcome.humanVictory, true);

  const score = calculateMatchScore(wonFactions[0], 180);
  assert.ok(score > 3000);
});

test('Room-boundary floating holotable coordinate mapping and 360-degree room vantages work accurately', () => {
  // 1:1 Desktop scale
  const pt1 = mapRoomWorldToArenaCoords(8.5, -12.0, 1.0);
  assert.deepEqual(pt1, { x: 8.5, z: -12.0 });

  // Quest 3 physical room-scale (0.1x scale maps 1.2m physical room point to 12.0m arena coord)
  const ptXR = mapRoomWorldToArenaCoords(1.2, -1.5, 0.1);
  assert.equal(Math.round(ptXR.x), 12);
  assert.equal(Math.round(ptXR.z), -15);

  // Clamping at room boundary edges
  const clamped = mapRoomWorldToArenaCoords(99, -99, 1.0);
  assert.deepEqual(clamped, { x: MAP_HALF_EXTENT, z: -MAP_HALF_EXTENT });

  // Verify all 6 walk-around room vantages exist
  assert.ok(ROOM_VANTAGE_PRESETS.south_sofa);
  assert.ok(ROOM_VANTAGE_PRESETS.east_credenza);
  assert.ok(ROOM_VANTAGE_PRESETS.north_tv);
  assert.ok(ROOM_VANTAGE_PRESETS.west_shelf);
  assert.ok(ROOM_VANTAGE_PRESETS.center_walk);
  assert.ok(ROOM_VANTAGE_PRESETS.overhead);
});

