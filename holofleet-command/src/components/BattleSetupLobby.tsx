import React from 'react';
import {
  ARMY_COLORS,
  HERO_COMMANDERS,
} from '../game/rules';
import {
  AIDifficulty,
  ArmyColorId,
  HeroId,
  PlayerSlotConfig,
} from '../game/types';

interface BattleSetupLobbyProps {
  slots: PlayerSlotConfig[];
  passthroughActive: boolean;
  furnitureBlend: number;
  onUpdateSlot: (slotIndex: number, patch: Partial<PlayerSlotConfig>) => void;
  onTogglePassthrough: () => void;
  onChangeFurnitureBlend: (val: number) => void;
  onOpenSideloadGuide: () => void;
  onStartBattle: () => void;
  onEnterImmersiveBattle: () => void;
}

const COLOR_IDS: ArmyColorId[] = ['cyan', 'amber', 'emerald', 'rose', 'violet', 'gold'];
const HERO_IDS: HeroId[] = ['valkyrie', 'aegis', 'hyperion', 'nexus'];
const DIFFICULTIES: AIDifficulty[] = ['easy', 'medium', 'hard', 'brutal'];

export const BattleSetupLobby: React.FC<BattleSetupLobbyProps> = ({
  slots,
  passthroughActive,
  furnitureBlend,
  onUpdateSlot,
  onTogglePassthrough,
  onChangeFurnitureBlend,
  onOpenSideloadGuide,
  onStartBattle,
  onEnterImmersiveBattle,
}) => {
  const humanSlot = slots[0];
  const selectedHero = HERO_COMMANDERS[humanSlot.heroId];
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const directImmersiveUrl = `${window.location.origin}/?autostart=1&immersive=1`;

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-8 pointer-events-none overflow-y-auto">
      {/* Top Left Brand & Custom Inline SVG Emblem over negative space */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pointer-events-auto">
        <div className="flex items-center gap-4 bg-[#050b18]/92 border border-cyan-500/30 rounded-xl px-5 py-3.5 shadow-2xl">
          <svg
            viewBox="0 0 64 64"
            className="w-12 h-12 shrink-0"
            aria-hidden="true"
          >
            <polygon
              points="32,4 58,19 58,45 32,60 6,45 6,19"
              fill="rgba(6, 182, 212, 0.14)"
              stroke="#06B6D4"
              strokeWidth="2.5"
            />
            <polygon
              points="32,12 49,22 49,42 32,52 15,42 15,22"
              fill="none"
              stroke="#67E8F9"
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
            <path
              d="M32 16 L42 42 L32 36 L22 42 Z"
              fill="#22D3EE"
              stroke="#ECFEFF"
              strokeWidth="1.5"
            />
            <circle cx="32" cy="30" r="3.5" fill="#FDE047" />
          </svg>
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-wider text-white">
              AETHER ROOM XR
            </h1>
            <p className="text-xs text-cyan-300/90 tracking-wide">
              Quest 3 Passthrough Living Room Fleet Command · 44m Grand Sector Map
            </p>
          </div>
        </div>

        {/* Full Immersive XR Launch, Sideload to Quest 3 & Furniture Blend Calibration Bar */}
        <div className="flex flex-wrap items-center gap-2.5 bg-[#050b18]/92 border border-slate-700/80 rounded-xl px-4 py-3 shadow-xl">
          <button
            type="button"
            data-testid="enter-full-immersive-lobby"
            onClick={onEnterImmersiveBattle}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-400 text-slate-950 hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-md shadow-emerald-500/20"
          >
            Enter Full Immersive XR Mode
          </button>

          {isInIframe && (
            <a
              href={directImmersiveUrl}
              target="_top"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 hover:bg-cyan-500/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Direct Quest WebXR Tab ↗
            </a>
          )}

          <button
            type="button"
            onClick={onOpenSideloadGuide}
            className="px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sideload to Quest 3 (APK / ADB)
          </button>

          <button
            type="button"
            onClick={onTogglePassthrough}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              passthroughActive
                ? 'bg-cyan-500 text-slate-950'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {passthroughActive ? 'Room Passthrough: ON' : 'Room Passthrough: OFF'}
          </button>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span className="whitespace-nowrap">Furniture Blend</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={furnitureBlend}
              aria-label="Furniture Tactical Blend"
              onChange={(e) => onChangeFurnitureBlend(parseFloat(e.target.value))}
              className="w-20 accent-cyan-400 cursor-pointer"
            />
            <span className="font-mono-num text-cyan-300 w-9 text-right">
              {Math.round(furnitureBlend * 100)}%
            </span>
          </label>
        </div>
      </div>

      {/* Main Battle Setup Panel (4-Player Skirmish & Commander Configurator) */}
      <div className="my-auto w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 pointer-events-auto">
        {/* Left 8 Columns: 4-Player Battle Setup Table */}
        <section
          aria-label="4-Player Skirmish Setup"
          className="lg:col-span-8 bg-[#050b18]/94 border border-slate-800 rounded-2xl p-5 shadow-2xl"
        >
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
            <div>
              <h2 className="font-display text-lg font-bold text-white">
                01. Skirmish Battle Setup (Up to 4 Commanders)
              </h2>
              <p className="text-xs text-slate-400">
                Configure Army Color, Hero Commander, Team Alliances, and individual AI Difficulty levels.
              </p>
            </div>
            <span className="text-xs text-cyan-300 font-mono-num">
              {slots.filter((s) => s.active || s.isHuman).length} / 4 Active Slots
            </span>
          </div>

          <div className="space-y-3">
            {slots.map((slot) => {
              const colorSpec = ARMY_COLORS[slot.colorId];
              return (
                <div
                  key={slot.slotIndex}
                  className={`grid grid-cols-1 md:grid-cols-12 items-center gap-2.5 p-3 rounded-xl border transition-colors ${
                    slot.active || slot.isHuman
                      ? 'bg-[#091326]/95 border-slate-700/90'
                      : 'bg-[#060c18]/75 border-slate-800/60 opacity-65'
                  }`}
                >
                  {/* Slot Role & Name (3 cols) */}
                  <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-xs shrink-0"
                      style={{ backgroundColor: colorSpec.hex }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {slot.isHuman ? 'Slot 1 · Commander' : `Slot ${slot.slotIndex + 1} · AI Fleet`}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {slot.name}
                      </div>
                    </div>
                  </div>

                  {/* Status / AI Difficulty Selector (3 cols) */}
                  <div className="md:col-span-3">
                    {slot.isHuman ? (
                      <div className="text-xs text-cyan-300 font-medium px-2.5 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-center whitespace-nowrap truncate">
                        Hand + Voice Control
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onUpdateSlot(slot.slotIndex, { active: !slot.active })}
                          aria-label={`Toggle Slot ${slot.slotIndex + 1}`}
                          className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            slot.active
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {slot.active ? 'Open' : 'Closed'}
                        </button>
                        {slot.active && (
                          <select
                            aria-label={`Slot ${slot.slotIndex + 1} AI Difficulty`}
                            value={slot.difficulty}
                            onChange={(e) =>
                              onUpdateSlot(slot.slotIndex, {
                                difficulty: e.target.value as AIDifficulty,
                              })
                            }
                            className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                          >
                            {DIFFICULTIES.map((d) => (
                              <option key={d} value={d}>
                                {d.charAt(0).toUpperCase() + d.slice(1)} AI
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Hero Commander Selector (2.5 -> 2 cols) */}
                  <div className="md:col-span-2">
                    <select
                      aria-label={`Slot ${slot.slotIndex + 1} Hero Commander`}
                      disabled={!slot.isHuman && !slot.active}
                      value={slot.heroId}
                      onChange={(e) =>
                        onUpdateSlot(slot.slotIndex, { heroId: e.target.value as HeroId })
                      }
                      className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 disabled:opacity-40"
                    >
                      {HERO_IDS.map((hId) => (
                        <option key={hId} value={hId}>
                          {HERO_COMMANDERS[hId].name.replace('Commander ', '').replace('Admiral ', '').replace('Archon ', '').replace('Prospector ', '')}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Team Selector & Army Color Swatches (4 cols so swatches never overflow) */}
                  <div className="md:col-span-4 flex items-center justify-between gap-2">
                    <select
                      aria-label={`Slot ${slot.slotIndex + 1} Team`}
                      disabled={!slot.isHuman && !slot.active}
                      value={slot.team}
                      onChange={(e) =>
                        onUpdateSlot(slot.slotIndex, {
                          team: Number(e.target.value) as 1 | 2 | 3 | 4,
                        })
                      }
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 font-mono-num focus:outline-none focus:border-cyan-400 disabled:opacity-40 shrink-0"
                    >
                      <option value={1}>Team 1</option>
                      <option value={2}>Team 2</option>
                      <option value={3}>Team 3</option>
                      <option value={4}>Team 4</option>
                    </select>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {COLOR_IDS.map((cId) => {
                        const c = ARMY_COLORS[cId];
                        const isSelected = slot.colorId === cId;
                        return (
                          <button
                            key={cId}
                            type="button"
                            disabled={!slot.isHuman && !slot.active}
                            aria-label={`Slot ${slot.slotIndex + 1} Color ${c.name}`}
                            onClick={() => onUpdateSlot(slot.slotIndex, { colorId: cId })}
                            className={`w-4 h-4 rounded-sm transition-transform cursor-pointer ${
                              isSelected
                                ? 'scale-115 ring-2 ring-white'
                                : 'opacity-65 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: c.hex }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right 4 Columns: Commander Dossier, Tech Tree Preview & Start CTA */}
        <section
          aria-label="Commander Dossier and Launch"
          className="lg:col-span-4 bg-[#050b18]/94 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-2xl"
        >
          <div>
            <div className="pb-3 mb-3 border-b border-slate-800">
              <div className="text-xs text-cyan-400 font-medium">
                Selected Commander Profile
              </div>
              <h3 className="font-display text-xl font-bold text-white mt-0.5">
                {selectedHero.name}
              </h3>
              <p className="text-xs text-slate-400">
                {selectedHero.title} · Passive: {selectedHero.passiveDesc}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#091326] border border-cyan-500/25 mb-4">
              <div className="text-xs font-semibold text-cyan-300">
                Hero Overdrive: {selectedHero.abilityName} ({selectedHero.cooldownSec}s CD)
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {selectedHero.abilityDesc}
              </p>
            </div>

            <div className="space-y-1.5 text-xs text-slate-300 mb-5">
              <div className="font-semibold text-white">
                3-Tier Living Room Base Progression:
              </div>
              <p className="text-slate-400">
                · <strong className="text-slate-200">Tier 1 Outpost</strong>: Mine asteroids with Astro Drones; build Ore Refinery &amp; Sensor Array.
              </p>
              <p className="text-slate-400">
                · <strong className="text-slate-200">Tier 2 Citadel</strong>: Build Orbital Shipyard &amp; Furniture Laser Grid; deploy Frigates &amp; Cruisers.
              </p>
              <p className="text-slate-400">
                · <strong className="text-slate-200">Tier 3 Bastion</strong>: Build Titan Foundry &amp; warp in <strong className="text-amber-300">Leviathan Titan Carriers</strong> that spawn autonomous micro-drone swarms.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-start="true"
            onClick={onStartBattle}
            className="w-full py-3.5 px-6 rounded-xl font-display text-base font-bold tracking-wider text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] transition-all cursor-pointer shadow-lg shadow-cyan-500/20 whitespace-nowrap"
          >
            Launch Living Room Battle [Enter]
          </button>
        </section>
      </div>

      {/* Flat Borderless Control Hint Line in Bottom Safe Margin */}
      <div className="text-center text-xs text-slate-400 pointer-events-none">
        Click Living Room Floor: Hand-Controller Tactical Pulse &amp; Rally · WASD / Drag: Orbit Room · Q/W/E/R/T: Deploy Ships · 1-5: Build Tech · Space: Hero Overdrive · P: Pause
      </div>
    </div>
  );
};
