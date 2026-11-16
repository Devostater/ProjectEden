import React, { useState } from 'react';
import {
  ARMY_COLORS,
  BASE_TIER_UPGRADE_RULES,
  BUILDING_SPECS,
  HERO_COMMANDERS,
  ROOM_VANTAGE_PRESETS,
  UNIT_SPECS,
  canBuildStructure,
  canDeployUnit,
  canUpgradeBaseTier,
} from '../game/rules';
import { WristWatchActionId } from '../game/HoloModels';
import {
  BuildingType,
  FactionState,
  HapticPulseEvent,
  RoomVantageAngle,
  SelectedUnitInfo,
  TacticalStance,
  UnitType,
  VoiceCommandIntent,
  WristWatchPanelState,
} from '../game/types';

interface TacticalHUDProps {
  factions: FactionState[];
  unitCounts: Record<UnitType, number>;
  selectedUnits: SelectedUnitInfo[];
  wristWatch: WristWatchPanelState;
  elapsedSec: number;
  passthroughActive: boolean;
  immersiveMode: boolean;
  furnitureBlend: number;
  muted: boolean;
  voiceListening: boolean;
  lastVoiceTranscript: string;
  recentHaptic: HapticPulseEvent | null;
  statusToast: string | null;
  onDeployUnit: (type: UnitType) => void;
  onSelectUnitsByFilter: (filter: UnitType | 'all_combat' | 'all' | 'clear') => void;
  onClearSelectedUnitOrders: () => void;
  onBuildStructure: (type: BuildingType) => void;
  onUpgradeTier: () => void;
  onTriggerHero: () => void;
  onSetStance: (stance: TacticalStance) => void;
  onExecuteVoiceIntent: (intent: VoiceCommandIntent) => void;
  onExecuteWristWatchAction: (action: WristWatchActionId) => void;
  onSetRoomVantage: (vantage: RoomVantageAngle) => void;
  onToggleVoiceMic: () => void;
  onStartXRPassthrough: () => void;
  onExitImmersiveMode: () => void;
  onOpenSideloadGuide: () => void;
  onChangeFurnitureBlend: (val: number) => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
}

const DEPLOYABLE_UNITS: UnitType[] = [
  'miner',
  'interceptor',
  'frigate',
  'cruiser',
  'carrier',
  'hero_flagship',
];

const BUILDABLE_TYPES: BuildingType[] = [
  'refinery',
  'sensor_array',
  'orbital_shipyard',
  'defense_grid',
  'titan_foundry',
];

const VANTAGE_LIST: RoomVantageAngle[] = [
  'south_sofa',
  'east_credenza',
  'north_tv',
  'west_shelf',
  'center_walk',
  'overhead',
];

export const TacticalHUD: React.FC<TacticalHUDProps> = ({
  factions,
  unitCounts,
  selectedUnits,
  wristWatch,
  elapsedSec,
  passthroughActive,
  immersiveMode,
  furnitureBlend,
  muted,
  voiceListening,
  lastVoiceTranscript,
  recentHaptic,
  statusToast,
  onDeployUnit,
  onSelectUnitsByFilter,
  onClearSelectedUnitOrders,
  onBuildStructure,
  onUpgradeTier,
  onTriggerHero,
  onSetStance,
  onExecuteVoiceIntent,
  onExecuteWristWatchAction,
  onSetRoomVantage,
  onToggleVoiceMic,
  onStartXRPassthrough,
  onExitImmersiveMode,
  onOpenSideloadGuide,
  onChangeFurnitureBlend,
  onToggleMute,
  onPause,
  onRestart,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'fleet' | 'tech' | 'voice'>('fleet');

  const human = factions.find((f) => f.isHuman) ?? factions[0];
  if (!human) return null;

  const heroSpec = HERO_COMMANDERS[human.heroId];
  const tierUpgradeCheck = canUpgradeBaseTier(human);
  const nextTierRule =
    human.baseTier === 1
      ? BASE_TIER_UPGRADE_RULES[2]
      : human.baseTier === 2
        ? BASE_TIER_UPGRADE_RULES[3]
        : null;

  const hpPct = Math.max(0, Math.min(100, Math.round((human.baseHp / human.maxBaseHp) * 100)));
  const shieldPct = Math.max(
    0,
    Math.min(100, Math.round((human.baseShield / human.maxBaseShield) * 100))
  );

  const mins = Math.floor(elapsedSec / 60);
  const secs = Math.floor(elapsedSec % 60);
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const directImmersiveUrl = `${window.location.origin}/?autostart=1&immersive=1`;

  // When Full Immersive 3D Mode is active, hide all 2D browser UI panels so the user is 100% immersed
  // in the 3D Living Room with their 3D Articulated Virtual Hands and 3D Floating Left-Wristwatch!
  if (immersiveMode) {
    return (
      <div
        data-testid="full-immersive-visor"
        className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="pointer-events-auto flex items-center gap-3 bg-[#050b18]/80 border border-emerald-400/50 rounded-xl px-3.5 py-2 shadow-xl">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div className="text-xs">
              <div className="font-display font-bold text-emerald-300 tracking-wide">
                FULL IMMERSIVE 3D XR MODE ACTIVE
              </div>
              <div className="text-[11px] text-slate-300">
                Click 3D Left-Wristwatch buttons to Deploy/Adjust · Click Ships &amp; Room Floor to Move/Attack · WASD Walk
              </div>
            </div>
          </div>

          <div className="pointer-events-auto flex flex-wrap items-center gap-2 bg-[#050b18]/85 border border-cyan-500/40 rounded-xl px-3 py-2 shadow-xl">
            {VANTAGE_LIST.map((vKey) => {
              const spec = ROOM_VANTAGE_PRESETS[vKey];
              const isAct = wristWatch.activeVantage === vKey;
              return (
                <button
                  key={vKey}
                  type="button"
                  onClick={() => onSetRoomVantage(vKey)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isAct
                      ? 'bg-cyan-400 text-slate-950'
                      : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {spec.shortLabel}
                </button>
              );
            })}

            {isInIframe && (
              <a
                href={directImmersiveUrl}
                target="_top"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 hover:bg-cyan-500/35 whitespace-nowrap cursor-pointer"
              >
                Direct Quest WebXR Tab ↗
              </a>
            )}

            <button
              type="button"
              data-testid="exit-immersive-btn"
              onClick={onExitImmersiveMode}
              className="px-3 py-1 rounded-md text-xs font-bold bg-rose-500/25 text-rose-200 border border-rose-400/50 hover:bg-rose-500/40 cursor-pointer whitespace-nowrap"
            >
              Show 2D HUD / Exit Immersive
            </button>
          </div>
        </div>

        {statusToast && (
          <div className="mx-auto bg-[#09152b]/90 border border-cyan-400/50 text-cyan-200 text-xs font-medium px-4 py-2 rounded-lg shadow-lg">
            {statusToast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 md:p-5">
      {/* Top Row: Left Resource & Station Cluster + Right Utility Controls */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left Perimeter Cluster: Primary Readouts */}
        <div className="pointer-events-auto flex flex-col gap-2.5 bg-[#050b18]/92 border border-cyan-500/35 rounded-xl px-4 py-3 shadow-2xl max-w-xl">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-cyan-400">
                ORE RESERVES
              </div>
              <div
                data-testid="hud-ore"
                className="font-mono-num text-2xl font-bold text-white hud-stroke leading-tight"
              >
                {Math.round(human.ore)}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold tracking-wider text-amber-400">
                PLASMA ENERGY
              </div>
              <div
                data-testid="hud-energy"
                className="font-mono-num text-2xl font-bold text-amber-300 hud-stroke leading-tight"
              >
                {Math.round(human.energy)}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold tracking-wider text-emerald-400">
                STATION TIER
              </div>
              <div
                data-testid="hud-tier"
                className="font-mono-num text-2xl font-bold text-emerald-300 hud-stroke leading-tight"
              >
                T{human.baseTier}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400">
                FLEET CAP
              </div>
              <div className="font-mono-num text-2xl font-bold text-slate-100 hud-stroke leading-tight">
                {human.supplyUsed}/{human.supplyCap}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400">
                TIME
              </div>
              <div className="font-mono-num text-lg font-bold text-slate-300 leading-tight">
                {timeFormatted}
              </div>
            </div>
          </div>

          {/* Station Vitality & Shield Bars */}
          <div className="grid grid-cols-2 gap-3 pt-1.5 border-t border-slate-800/90">
            <div>
              <div className="flex justify-between text-[11px] text-slate-300 font-mono-num mb-1">
                <span>HQ Hull (5 Local Asteroids)</span>
                <span>{Math.round(human.baseHp)} HP</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-sm overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-emerald-400 transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${hpPct / 100})` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-cyan-300 font-mono-num mb-1">
                <span>Phase Shield</span>
                <span>{Math.round(human.baseShield)} SHD</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-sm overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-cyan-400 transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${shieldPct / 100})` }}
                />
              </div>
            </div>
          </div>

          {/* Compact Multi-Faction Sector Radar Strip */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 pt-1">
            {factions
              .filter((f) => !f.isHuman)
              .map((enemy) => {
                const c = ARMY_COLORS[enemy.colorId];
                const ePct = Math.max(0, Math.round((enemy.baseHp / enemy.maxBaseHp) * 100));
                return (
                  <div key={enemy.slotIndex} className="flex items-center gap-1.5 font-mono-num">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="truncate max-w-[115px]">{enemy.name}:</span>
                    <span className={enemy.defeated ? 'text-rose-400' : 'text-white'}>
                      {enemy.defeated ? 'DESTROYED' : `T${enemy.baseTier} · ${ePct}%`}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Top-Right Perimeter Cluster: Sideload Guide, XR Passthrough, Voice & Utility Controls */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 bg-[#050b18]/92 border border-slate-700/80 rounded-xl p-2 shadow-xl">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSideloadGuide();
              }}
              aria-label="Open Quest 3 Sideload Guide"
              className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Quest 3 Sideload
            </button>

            <button
              type="button"
              data-testid="enter-full-immersive-hud"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onStartXRPassthrough();
              }}
              aria-label="Enter Full Immersive XR Mode"
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-400 text-slate-950 hover:bg-emerald-300 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-md shadow-emerald-500/20"
            >
              Enter Full Immersive XR
            </button>

            <label className="hidden xl:flex items-center gap-2 px-2 text-xs text-slate-300">
              <span className="whitespace-nowrap">Room Grid</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={furnitureBlend}
                aria-label="Living Room Furniture Tactical Overlay Blend"
                onChange={(e) => onChangeFurnitureBlend(parseFloat(e.target.value))}
                className="w-20 accent-cyan-400 cursor-pointer"
              />
            </label>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleVoiceMic();
              }}
              aria-label="Toggle Voice Command Microphone"
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                voiceListening
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {voiceListening ? 'Voice Link: Listening' : 'Voice Command'}
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
                {muted ? (
                  <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                ) : (
                  <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                )}
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Game [P]"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Restart Match [R]"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 bg-[#050b18]/92 border border-cyan-500/30 rounded-xl px-2.5 py-1.5 shadow-lg">
            <span className="text-[11px] font-semibold text-cyan-300 whitespace-nowrap">
              Walk Around Room [C]:
            </span>
            {VANTAGE_LIST.map((vKey) => {
              const spec = ROOM_VANTAGE_PRESETS[vKey];
              const isAct = wristWatch.activeVantage === vKey;
              return (
                <button
                  key={vKey}
                  type="button"
                  onClick={() => onSetRoomVantage(vKey)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isAct
                      ? 'bg-cyan-400 text-slate-950'
                      : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {spec.shortLabel}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 text-xs bg-[#050b18]/90 border border-slate-800 rounded-lg px-3 py-1.5 font-mono-num">
            <button
              type="button"
              onClick={() => onExecuteWristWatchAction('TOGGLE_PANEL')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer whitespace-nowrap ${
                wristWatch.open
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              Wristwatch [V]: {wristWatch.open ? 'OPEN' : 'MINIMIZED'}
            </button>
            <button
              type="button"
              onClick={() => onExecuteWristWatchAction('TOGGLE_PIN')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer whitespace-nowrap ${
                wristWatch.pinnedInRoom
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-slate-800 text-amber-300 border border-amber-500/30'
              }`}
            >
              {wristWatch.pinnedInRoom ? 'Watch: Pinned in Room' : 'Pin Watch in Room'}
            </button>
            <div className="flex items-center gap-1 text-slate-300">
              <span>Float Y: {wristWatch.battleElevationY.toFixed(2)}m</span>
              <button
                type="button"
                aria-label="Lower Floating Battle Level"
                onClick={() => onExecuteWristWatchAction('HEIGHT_DOWN')}
                className="px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 rounded text-cyan-300 cursor-pointer"
              >
                -
              </button>
              <button
                type="button"
                aria-label="Raise Floating Battle Level"
                onClick={() => onExecuteWristWatchAction('HEIGHT_UP')}
                className="px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 rounded text-cyan-300 cursor-pointer"
              >
                +
              </button>
            </div>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-cyan-300">
              {recentHaptic ? recentHaptic.label : 'Quest 3 Dual-Rumble Ready'}
            </span>
            {lastVoiceTranscript && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-amber-300 truncate max-w-[160px]">
                  Voice: &ldquo;{lastVoiceTranscript}&rdquo;
                </span>
              </>
            )}
          </div>

          {statusToast && (
            <div
              role="status"
              className="bg-[#09152b] border border-cyan-400/50 text-cyan-200 text-xs font-medium px-3.5 py-2 rounded-lg shadow-lg"
            >
              {statusToast}
            </div>
          )}
        </div>
      </div>

      {/* Unified Collapsible Bottom Tactical Control Dock */}
      <div className="pointer-events-auto mx-auto w-full max-w-[1140px] flex flex-col items-center">
        {/* Direct Unit Selection & Tactical Move/Attack Bar */}
        <div className="w-full mb-1.5 flex flex-wrap items-center justify-between gap-2 bg-[#061022]/95 border border-emerald-500/40 rounded-xl px-3.5 py-2 shadow-lg">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-emerald-300 whitespace-nowrap">
              {selectedUnits.length > 0
                ? `Selected (${selectedUnits.length}): ${selectedUnits[0].name}${
                    selectedUnits.length > 1 ? ` +${selectedUnits.length - 1}` : ''
                  }`
                : 'Tactical Selection (Mouse / VR Virtual Hands):'}
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-300">
              {selectedUnits.length > 0
                ? `${selectedUnits[0].orderLabel} — Click Floating Room Level to Move or Click Enemy to Attack`
                : 'Tap Left Wristwatch in 3D or click any friendly ship, then click where to Move/Attack'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectUnitsByFilter('all_combat')}
              className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 cursor-pointer whitespace-nowrap"
            >
              Select Combat Fleet
            </button>
            <button
              type="button"
              onClick={() => onSelectUnitsByFilter('miner')}
              className="px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 cursor-pointer whitespace-nowrap"
            >
              Select Miners
            </button>
            {selectedUnits.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={onClearSelectedUnitOrders}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap"
                >
                  Autonomous AI
                </button>
                <button
                  type="button"
                  onClick={() => onSelectUnitsByFilter('clear')}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-400 hover:text-white cursor-pointer whitespace-nowrap"
                >
                  Deselect
                </button>
              </>
            )}
          </div>
        </div>

        {/* Collapse / Expand Cinema Drawer Button */}
        <button
          type="button"
          onClick={() => setDockCollapsed((prev) => !prev)}
          className="px-4 py-1 rounded-t-lg bg-[#050b18]/95 border border-b-0 border-slate-700 text-xs font-medium text-cyan-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
        >
          {dockCollapsed ? '▴ Show Tactical Command Dock' : '▾ Hide Tactical Command Dock'}
        </button>

        {!dockCollapsed && (
          <div className="w-full bg-[#050b18]/95 border border-slate-700/90 rounded-2xl p-3.5 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800">
              <div className="flex items-center gap-1 p-1 bg-[#091326] rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('fleet')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'fleet'
                      ? 'bg-cyan-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Deploy Fleet ({human.supplyUsed}/{human.supplyCap})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('tech')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'tech'
                      ? 'bg-cyan-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Base Tier &amp; Tech ({human.buildings.length}/5)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('voice')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'voice'
                      ? 'bg-cyan-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Voice &amp; Tactical Stance
                </button>
              </div>

              <div className="flex items-center gap-2">
                {nextTierRule ? (
                  <button
                    type="button"
                    onClick={onUpgradeTier}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      tierUpgradeCheck.allowed
                        ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                        : 'bg-slate-800/90 text-slate-400 border border-slate-700'
                    }`}
                  >
                    Upgrade to Tier {nextTierRule.targetTier} ({nextTierRule.costOre} Ore ·{' '}
                    {nextTierRule.costEnergy} En)
                  </button>
                ) : (
                  <span className="text-xs font-semibold text-emerald-300 px-2.5 py-1 whitespace-nowrap">
                    Tier 3 Max Bastion Active
                  </span>
                )}

                <button
                  type="button"
                  onClick={onTriggerHero}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    human.heroCooldown <= 0
                      ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                      : 'bg-slate-800 text-amber-300/70 border border-amber-500/30'
                  }`}
                >
                  {human.heroCooldown <= 0
                    ? `${heroSpec.abilityName} [Space]`
                    : `${heroSpec.abilityName} (${Math.ceil(human.heroCooldown)}s)`}
                </button>
              </div>
            </div>

            {activeTab === 'fleet' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {DEPLOYABLE_UNITS.map((uType) => {
                  const spec = UNIT_SPECS[uType];
                  const check = canDeployUnit(human, uType);
                  const count = unitCounts[uType] || 0;
                  const isCarrier = uType === 'carrier';
                  return (
                    <div
                      key={uType}
                      className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${
                        check.allowed
                          ? isCarrier
                            ? 'bg-amber-950/40 border-amber-400/60'
                            : 'bg-[#091326] border-slate-700'
                          : 'bg-[#070d19]/80 border-slate-800/80 opacity-65'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => onDeployUnit(uType)}
                            className="text-xs font-bold text-white hover:text-cyan-300 truncate text-left cursor-pointer"
                          >
                            {spec.name.replace('Astro ', '').replace('Aegis ', '').replace('Leviathan ', '')}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              count > 0 ? onSelectUnitsByFilter(uType) : onDeployUnit(uType)
                            }
                            aria-label={`Select all ${spec.name}`}
                            className="font-mono-num text-[11px] text-emerald-300 hover:text-white shrink-0 whitespace-nowrap cursor-pointer"
                          >
                            [{spec.keyHint}] x{count}
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {spec.role}
                        </div>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono-num whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onDeployUnit(uType)}
                          className="text-cyan-300 hover:text-white cursor-pointer"
                        >
                          +Deploy ({spec.costOre} Ore · {spec.costEnergy} En)
                        </button>
                        <span className="text-slate-400">T{spec.tierRequired}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'tech' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {BUILDABLE_TYPES.map((bType) => {
                  const spec = BUILDING_SPECS[bType];
                  const built = human.buildings.includes(bType);
                  const check = canBuildStructure(human, bType);
                  return (
                    <button
                      key={bType}
                      type="button"
                      disabled={built}
                      onClick={() => onBuildStructure(bType)}
                      className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        built
                          ? 'bg-emerald-950/35 border-emerald-500/50'
                          : check.allowed
                            ? 'bg-[#091326] border-slate-700 hover:border-cyan-400'
                            : 'bg-[#070d19]/80 border-slate-800 opacity-60'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-white truncate">
                            {spec.name}
                          </span>
                          <span className="font-mono-num text-[11px] text-cyan-300 shrink-0">
                            {built ? 'ONLINE' : `[${spec.keyHint}]`}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                          {spec.description}
                        </p>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono-num">
                        <span className="text-amber-300">
                          {built ? spec.unlocksText : `${spec.costOre} Ore · ${spec.costEnergy} En`}
                        </span>
                        <span className="text-slate-400">T{spec.tierRequired}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'voice' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Tactical Stance:</span>
                  {(
                    [
                      { id: 'attack', label: 'All Units Attack' },
                      { id: 'defend', label: 'Defend Living Room HQ' },
                      { id: 'focus_carriers', label: 'Focus Hostile Carriers' },
                      { id: 'harvest', label: 'Prioritize Asteroid Mining' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onSetStance(st.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        human.stance === st.id
                          ? 'bg-cyan-400 text-slate-950'
                          : 'bg-[#091326] text-slate-200 border border-slate-700 hover:border-cyan-400'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onExecuteVoiceIntent('DEPLOY_CARRIER')}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Voice: &ldquo;Deploy Titan Carrier&rdquo;
                  </button>
                  <button
                    type="button"
                    onClick={() => onExecuteVoiceIntent('HERO_ABILITY')}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Voice: &ldquo;Activate Hero Overdrive&rdquo;
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
