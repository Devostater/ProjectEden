import React from 'react';
import { GameState, RunSummarySnapshot } from '../game/types';

interface StatusModalProps {
  gameState: GameState;
  summary: RunSummarySnapshot | null;
  onResume: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  gameState,
  summary,
  onResume,
  onRestart,
  onReturnToTitle,
}) => {
  if (gameState !== 'paused' && gameState !== 'gameover') return null;

  const isPaused = gameState === 'paused';
  const isVictory = summary?.victory ?? false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-modal-title"
      className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#020611]/82"
    >
      <div className="w-full max-w-md bg-[#060e20] border border-cyan-500/40 rounded-2xl p-6 shadow-2xl">
        <div className="text-center pb-4 border-b border-slate-800">
          <div className="text-xs font-semibold tracking-wider text-cyan-400">
            {isPaused
              ? 'TACTICAL SIMULATION SUSPENDED'
              : isVictory
                ? 'LIVING ROOM SECTOR SECURED'
                : 'COMMAND STATION BREACHED'}
          </div>
          <h2
            id="status-modal-title"
            className="font-display text-2xl font-bold text-white mt-1"
          >
            {isPaused
              ? 'Command Paused'
              : isVictory
                ? 'Victory: Fleet Triumphant'
                : 'Defeat: Sector Overrun'}
          </h2>
          {!isPaused && summary && (
            <p className="text-xs text-slate-400 mt-1">
              Winning Alliance: Team {summary.winnerTeam} ({summary.winnerName})
            </p>
          )}
        </div>

        {!isPaused && summary && (
          <div className="grid grid-cols-3 gap-3 my-5">
            <div className="bg-[#09152b] border border-slate-800 rounded-xl p-3 text-center">
              <div className="text-[11px] text-slate-400">SCORE / BEST</div>
              <div className="font-mono-num text-lg font-bold text-cyan-300 mt-0.5">
                {summary.score} / {summary.bestScore}
              </div>
            </div>
            <div className="bg-[#09152b] border border-slate-800 rounded-xl p-3 text-center">
              <div className="text-[11px] text-slate-400">CLEAR TIME</div>
              <div className="font-mono-num text-lg font-bold text-white mt-0.5">
                {summary.clearTimeSec}s
              </div>
            </div>
            <div className="bg-[#09152b] border border-slate-800 rounded-xl p-3 text-center">
              <div className="text-[11px] text-slate-400">HOSTILES KO</div>
              <div className="font-mono-num text-lg font-bold text-amber-300 mt-0.5">
                {summary.hostilesDestroyed}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5 mt-5">
          {isPaused ? (
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 px-4 rounded-xl font-display text-sm font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-colors cursor-pointer"
            >
              Resume Living Room Battle [Esc / P]
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onRestart}
              className="w-full py-3 px-4 rounded-xl font-display text-sm font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-colors cursor-pointer"
            >
              Play Again [Enter]
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Restart Skirmish [R]
          </button>

          <button
            type="button"
            onClick={onReturnToTitle}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-300 bg-[#091326] border border-slate-700 hover:border-cyan-400 transition-colors cursor-pointer"
          >
            Return to 4-Player Battle Setup
          </button>
        </div>
      </div>
    </div>
  );
};
