import { useCallback, useEffect, useRef, useState } from 'react';
import { BattleSetupLobby } from './components/BattleSetupLobby';
import { QuestSideloadModal } from './components/QuestSideloadModal';
import { StatusModal } from './components/StatusModal';
import { TacticalHUD } from './components/TacticalHUD';
import { SimulationCommandAPI, TacticalXRViewport } from './components/TacticalXRViewport';
import {
  DEFAULT_PLAYER_SLOTS,
  createInitialFactions,
  parseVoiceTranscriptToCommand,
} from './game/rules';
import { soundAndHaptics } from './game/soundAndHaptics';
import {
  FactionState,
  GameState,
  HapticPulseEvent,
  PlayerSlotConfig,
  RunSummarySnapshot,
  SelectedUnitInfo,
  UnitType,
  VoiceCommandIntent,
  WristWatchPanelState,
} from './game/types';

export default function App() {
  const searchParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isAutostart = searchParams?.get('autostart') === '1';
  const isAutoImmersive = searchParams?.get('immersive') === '1';

  const [gameState, setGameState] = useState<GameState>(isAutostart ? 'playing' : 'title');
  const [immersiveMode, setImmersiveMode] = useState<boolean>(Boolean(isAutoImmersive));
  const [playerSlots, setPlayerSlots] = useState<PlayerSlotConfig[]>(DEFAULT_PLAYER_SLOTS);
  const [factions, setFactions] = useState<FactionState[]>(() =>
    createInitialFactions(DEFAULT_PLAYER_SLOTS)
  );
  const [unitCounts, setUnitCounts] = useState<Record<UnitType, number>>({
    miner: 2,
    interceptor: 2,
    frigate: 0,
    cruiser: 0,
    carrier: 0,
    micro_drone: 0,
    hero_flagship: 0,
  });
  const [selectedUnits, setSelectedUnits] = useState<SelectedUnitInfo[]>([]);
  const [wristWatch, setWristWatch] = useState<WristWatchPanelState>({
    open: true,
    pinnedInRoom: false,
    panelScale: 1.0,
    panelTiltDeg: 0,
    battleElevationY: 1.65,
    roomBoundaryScale: 1.0,
    activeVantage: 'south_sofa',
  });
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [passthroughActive, setPassthroughActive] = useState<boolean>(true);
  const [furnitureBlend, setFurnitureBlend] = useState<number>(0.7);
  const [muted, setMuted] = useState<boolean>(false);
  const [voiceListening, setVoiceListening] = useState<boolean>(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState<string>('');
  const [recentHaptic, setRecentHaptic] = useState<HapticPulseEvent | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummarySnapshot | null>(null);
  const [sideloadModalOpen, setSideloadModalOpen] = useState<boolean>(false);

  const simApiRef = useRef<SimulationCommandAPI | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setStatusToast(null);
    }, 3200);
  }, []);

  // Sync gameState to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = gameState;
  }, [gameState]);

  // Subscribe to Haptic Feedback pulses
  useEffect(() => {
    soundAndHaptics.onHapticPulse((evt) => {
      setRecentHaptic(evt);
    });
    return () => {
      soundAndHaptics.onHapticPulse(null);
    };
  }, []);

  const handleStartBattle = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setRunSummary(null);
    document.body.dataset.state = 'playing';
    setGameState('playing');
    simApiRef.current?.resetMatch(playerSlots);
    soundAndHaptics.playUpgradeOrBuild();
  }, [playerSlots]);

  const handleEnterImmersiveBattle = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setRunSummary(null);
    document.body.dataset.state = 'playing';
    setGameState('playing');
    simApiRef.current?.resetMatch(playerSlots);
    soundAndHaptics.playUpgradeOrBuild();
    // Synchronously request WebXR / Full Immersive 3D Mode inside the user click gesture!
    void simApiRef.current?.startWebXRPassthrough();
  }, [playerSlots]);

  const handleRestartMatch = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setRunSummary(null);
    document.body.dataset.state = 'playing';
    setGameState('playing');
    simApiRef.current?.resetMatch(playerSlots);
    showToast('Living Room Tactical Skirmish Restarted');
  }, [playerSlots, showToast]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundAndHaptics.muted = next;
      return next;
    });
  }, []);

  const handleExecuteVoiceIntent = useCallback(
    (intent: VoiceCommandIntent, spokenText?: string) => {
      if (spokenText) {
        setLastVoiceTranscript(spokenText);
      } else {
        setLastVoiceTranscript(intent.replace('_', ' '));
      }
      const feedback = simApiRef.current?.executeVoiceCommand(intent);
      if (feedback) {
        showToast(feedback);
      }
    },
    [showToast]
  );

  const handleToggleVoiceMic = useCallback(() => {
    if (voiceListening) {
      speechRecRef.current?.stop();
      setVoiceListening(false);
      showToast('Voice Tactical Link Disengaged');
      return;
    }

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;

    if (!SpeechRec) {
      // Fallback tactical voice command execution when browser lacks SpeechRecognition
      setVoiceListening(true);
      handleExecuteVoiceIntent('ALL_ATTACK', 'All units attack hostile fleet');
      window.setTimeout(() => setVoiceListening(false), 1800);
      return;
    }

    try {
      const rec = new SpeechRec() as {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = (event) => {
        const lastIdx = event.results.length - 1;
        const transcript = event.results[lastIdx]?.[0]?.transcript || '';
        setLastVoiceTranscript(transcript);
        const intent = parseVoiceTranscriptToCommand(transcript);
        if (intent) {
          handleExecuteVoiceIntent(intent, transcript);
        } else {
          showToast(`Heard: "${transcript}" — Try "Attack", "Defend", "Deploy Carrier"`);
        }
      };
      rec.onerror = () => {
        setVoiceListening(false);
      };
      rec.onend = () => {
        setVoiceListening(false);
      };
      rec.start();
      speechRecRef.current = rec;
      setVoiceListening(true);
      showToast('Voice Link Active: Say "All Units Attack", "Deploy Carrier", or "Defend Base"');
    } catch {
      handleExecuteVoiceIntent('ALL_ATTACK', 'All units attack');
    }
  }, [voiceListening, handleExecuteVoiceIntent, showToast]);

  // Global Keyboard Shortcuts (Enter/Space on Title, P/Esc Pause, M Mute, R Restart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (gameState === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        handleStartBattle();
        return;
      }

      if (gameState === 'gameover' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        handleRestartMatch();
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (immersiveMode && e.code === 'Escape') {
          simApiRef.current?.exitFullImmersiveMode();
          return;
        }
        if (gameState === 'playing') {
          setGameState('paused');
        } else if (gameState === 'paused') {
          setGameState('playing');
        }
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      } else if (e.code === 'KeyR' && (e.shiftKey || gameState === 'paused')) {
        handleRestartMatch();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, immersiveMode, handleStartBattle, handleRestartMatch, handleToggleMute]);

  const handleUpdateSlot = useCallback(
    (slotIndex: number, patch: Partial<PlayerSlotConfig>) => {
      setPlayerSlots((prev) => {
        const next = prev.map((s) => (s.slotIndex === slotIndex ? { ...s, ...patch } : s));
        simApiRef.current?.resetMatch(next);
        return next;
      });
    },
    []
  );

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#040812] select-none">
      {/* Persistent 3D Holographic Living Room WebGL / WebXR Viewport */}
      <TacticalXRViewport
        gameState={gameState}
        playerSlots={playerSlots}
        passthroughActive={passthroughActive}
        immersiveMode={immersiveMode}
        furnitureBlend={furnitureBlend}
        onTogglePassthrough={() => setPassthroughActive((p) => !p)}
        onImmersiveModeChange={setImmersiveMode}
        onAdjustFurnitureBlend={setFurnitureBlend}
        onHudSync={(nextFactions, nextCounts, nextSelected, nextWristWatch, nextElapsed) => {
          setFactions(nextFactions);
          setUnitCounts(nextCounts);
          setSelectedUnits(nextSelected);
          setWristWatch(nextWristWatch);
          setElapsedSec(nextElapsed);
        }}
        onMatchEnd={(summary) => {
          setRunSummary(summary);
          setGameState('gameover');
        }}
        onStatusToast={showToast}
        apiRef={simApiRef}
      />

      {/* Title Screen & 4-Player Skirmish Battle Setup */}
      {gameState === 'title' && (
        <BattleSetupLobby
          slots={playerSlots}
          passthroughActive={passthroughActive}
          furnitureBlend={furnitureBlend}
          onUpdateSlot={handleUpdateSlot}
          onTogglePassthrough={() => setPassthroughActive((p) => !p)}
          onChangeFurnitureBlend={setFurnitureBlend}
          onStartBattle={handleStartBattle}
          onEnterImmersiveBattle={handleEnterImmersiveBattle}
          onOpenSideloadGuide={() => setSideloadModalOpen(true)}
        />
      )}

      {/* Active Gameplay HUD & Collapsible Bottom Tactical Dock */}
      {gameState === 'playing' && (
        <TacticalHUD
          factions={factions}
          unitCounts={unitCounts}
          selectedUnits={selectedUnits}
          wristWatch={wristWatch}
          elapsedSec={elapsedSec}
          passthroughActive={passthroughActive}
          immersiveMode={immersiveMode}
          furnitureBlend={furnitureBlend}
          muted={muted}
          voiceListening={voiceListening}
          lastVoiceTranscript={lastVoiceTranscript}
          recentHaptic={recentHaptic}
          statusToast={statusToast}
          onDeployUnit={(uType) => simApiRef.current?.deployUnit(uType)}
          onBuildStructure={(bType) => simApiRef.current?.buildStructure(bType)}
          onUpgradeTier={() => simApiRef.current?.upgradeTier()}
          onTriggerHero={() => simApiRef.current?.triggerHeroAbility()}
          onSetStance={(stance) => simApiRef.current?.setStance(stance)}
          onSelectUnitsByFilter={(filter) => simApiRef.current?.selectUnitsByFilter(filter)}
          onClearSelectedUnitOrders={() => simApiRef.current?.clearSelectedUnitOrders()}
          onExecuteVoiceIntent={(intent) => handleExecuteVoiceIntent(intent)}
          onExecuteWristWatchAction={(action) =>
            simApiRef.current?.executeWristWatchAction(action)
          }
          onSetRoomVantage={(vantage) => simApiRef.current?.setRoomVantage(vantage)}
          onToggleVoiceMic={handleToggleVoiceMic}
          onStartXRPassthrough={() => void simApiRef.current?.startWebXRPassthrough()}
          onExitImmersiveMode={() => simApiRef.current?.exitFullImmersiveMode()}
          onChangeFurnitureBlend={setFurnitureBlend}
          onToggleMute={handleToggleMute}
          onPause={() => setGameState('paused')}
          onRestart={handleRestartMatch}
          onOpenSideloadGuide={() => setSideloadModalOpen(true)}
        />
      )}

      {/* Pause / Victory / Defeat Status Modal */}
      <StatusModal
        gameState={gameState}
        summary={runSummary}
        onResume={() => setGameState('playing')}
        onRestart={handleRestartMatch}
        onReturnToTitle={() => {
          setGameState('title');
          setImmersiveMode(false);
          simApiRef.current?.resetMatch(playerSlots);
        }}
      />

      {/* Meta Quest 3 Sideload & APK Guide Modal */}
      <QuestSideloadModal
        open={sideloadModalOpen}
        onClose={() => setSideloadModalOpen(false)}
      />
    </main>
  );
}
