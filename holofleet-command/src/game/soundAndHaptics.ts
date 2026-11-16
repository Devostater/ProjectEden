import { HapticPulseEvent } from './types';

class SoundAndHapticsEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  private xrSession: XRSession | null = null;
  private onHapticCallback: ((evt: HapticPulseEvent) => void) | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setXRSession(session: XRSession | null) {
    this.xrSession = session;
  }

  public onHapticPulse(cb: ((evt: HapticPulseEvent) => void) | null) {
    this.onHapticCallback = cb;
  }

  public triggerHaptics(intensity: number, durationMs: number, label: string) {
    const clampedIntensity = Math.max(0.1, Math.min(1.0, intensity));
    // 1. Trigger Quest 3 / WebXR Hand Controller haptics if in XR session
    if (this.xrSession && this.xrSession.inputSources) {
      for (const source of this.xrSession.inputSources) {
        const gp = source.gamepad;
        if (!gp) continue;
        const actuators = (gp as unknown as { hapticActuators?: Array<{ pulse: (val: number, dur: number) => Promise<void> }> }).hapticActuators;
        if (actuators && actuators.length > 0) {
          actuators[0].pulse(clampedIntensity, durationMs).catch(() => {});
        }
        const vib = (gp as unknown as {
          vibrationActuator?: {
            playEffect: (
              type: string,
              params: { duration: number; strongMagnitude: number; weakMagnitude: number }
            ) => Promise<void>;
          };
        }).vibrationActuator;
        if (vib && typeof vib.playEffect === 'function') {
          vib
            .playEffect('dual-rumble', {
              duration: durationMs,
              strongMagnitude: clampedIntensity,
              weakMagnitude: clampedIntensity * 0.8,
            })
            .catch(() => {});
        }
      }
    }

    // 2. Standard Gamepad API fallback (for desktop/wireless controllers)
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        if (!pad) continue;
        const vib = (pad as unknown as {
          vibrationActuator?: {
            playEffect: (
              type: string,
              params: { duration: number; strongMagnitude: number; weakMagnitude: number }
            ) => Promise<void>;
          };
        }).vibrationActuator;
        if (vib && typeof vib.playEffect === 'function') {
          vib
            .playEffect('dual-rumble', {
              duration: durationMs,
              strongMagnitude: clampedIntensity,
              weakMagnitude: clampedIntensity * 0.7,
            })
            .catch(() => {});
        }
      }
    }

    // 3. Mobile / headset vibration fallback
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(Math.round(durationMs));
      } catch {
        // Ignore
      }
    }

    // 4. Notify HUD Haptic Feedback Visualizer
    if (this.onHapticCallback) {
      this.onHapticCallback({
        id: `hap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        intensity: clampedIntensity,
        durationMs,
        label,
        timestamp: Date.now(),
      });
    }
  }

  public playLaserPew(isHeavy = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const pitchVariation = 0.92 + Math.random() * 0.16;
    osc.type = isHeavy ? 'sawtooth' : 'triangle';
    const startFreq = (isHeavy ? 520 : 880) * pitchVariation;
    const endFreq = (isHeavy ? 110 : 210) * pitchVariation;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + (isHeavy ? 0.16 : 0.09));

    gain.gain.setValueAtTime(isHeavy ? 0.09 : 0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isHeavy ? 0.17 : 0.095));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (isHeavy ? 0.18 : 0.1));
  }

  public playExplosion(weight: 'light' | 'medium' | 'carrier') {
    const intensity = weight === 'carrier' ? 1.0 : weight === 'medium' ? 0.65 : 0.35;
    const dur = weight === 'carrier' ? 380 : weight === 'medium' ? 190 : 95;
    const label =
      weight === 'carrier'
        ? 'TITAN SHOCKWAVE (1.0G)'
        : weight === 'medium'
          ? 'HULL BREACH PULSE (0.65G)'
          : 'DRONE DETONATION (0.35G)';
    this.triggerHaptics(intensity, dur, label);

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    const startFreq = weight === 'carrier' ? 140 : weight === 'medium' ? 190 : 260;
    const durationSec = weight === 'carrier' ? 0.55 : weight === 'medium' ? 0.28 : 0.16;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + durationSec);

    gain.gain.setValueAtTime(weight === 'carrier' ? 0.18 : 0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  public playCarrierDeploy() {
    this.triggerHaptics(0.85, 280, 'TITAN WARP ENTRY (0.85G)');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.75);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.82);
  }

  public playUpgradeOrBuild() {
    this.triggerHaptics(0.45, 120, 'HOLOGRAPHIC FABRICATION (0.45G)');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(660, now + 0.08);
    osc.frequency.setValueAtTime(880, now + 0.16);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playVoiceAck() {
    this.triggerHaptics(0.3, 80, 'VOICE TACTICAL LINK (0.30G)');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.07);

    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }
}

export const soundAndHaptics = new SoundAndHapticsEngine();
