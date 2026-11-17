import React, { useEffect, useRef, useState } from 'react';

// A little toy radar: your ship sits in the middle, a green sweep goes round, and every
// so often a red bug blips onto the screen. The ship turns to face it and fires a flashing
// triangle missile. Nothing here talks to the hub; it is just for fun.

const SIZE = 240; // drawing size (the canvas is scaled to fit the panel)
const C = SIZE / 2; // centre
const R = C - 6; // radar radius
const MAX_BUGS = 3;

interface Bug { x: number; y: number; born: number; phase: number; targeted: boolean; fireAt: number; vx: number; vy: number }
interface Missile { x: number; y: number; angle: number; target: Bug; age: number }
interface Boom { x: number; y: number; age: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
// Shortest turn from angle a to angle b.
const turnBetween = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const triangle = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, size * 0.7);
  ctx.lineTo(-size * 0.7, -size * 0.7);
  ctx.closePath();
  ctx.restore();
};

export default function RadarWidget({ maxWidth = 240 }: { maxWidth?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [kills, setKills] = useState(0);
  // Highest score so far, remembered on this computer between visits
  const [best, setBest] = useState(() => { let v = 0; try { v = Number(localStorage.getItem('eden_radar_best')) || 0; } catch {} return v; });

  useEffect(() => {
    if (kills <= best) return;
    setBest(kills);
    try { localStorage.setItem('eden_radar_best', String(kills)); } catch {}
  }, [kills, best]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const bugs: Bug[] = [];
    const missiles: Missile[] = [];
    const booms: Boom[] = [];
    let shipAngle = -Math.PI / 2;
    let sweep = 0;
    let nextSpawn = 0.6;
    let t = 0;
    let last = performance.now();
    let raf = 0;

    const spawnBug = () => {
      const a = rand(0, Math.PI * 2);
      const d = rand(R * 0.4, R * 0.92);
      bugs.push({ x: C + Math.cos(a) * d, y: C + Math.sin(a) * d, born: t, phase: rand(0, 6), targeted: false, fireAt: t + rand(0.5, 1.1), vx: rand(-6, 6), vy: rand(-6, 6) });
    };

    const step = (dt: number) => {
      t += dt;
      sweep += dt * 2.2;
      // Now and then a new bug shows up
      if (t >= nextSpawn && bugs.length < MAX_BUGS) { spawnBug(); nextSpawn = t + rand(1.6, 4); }
      else if (t >= nextSpawn) nextSpawn = t + 1;
      // Bugs wander about, and stay inside the screen
      for (const b of bugs) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (Math.hypot(b.x - C, b.y - C) > R - 8) { b.vx = -b.vx; b.vy = -b.vy; }
      }
      // Ship turns to the oldest bug it has not shot at yet
      const aim = bugs.find((b) => !b.targeted);
      if (aim) {
        const want = Math.atan2(aim.y - C, aim.x - C);
        const d = turnBetween(shipAngle, want);
        shipAngle += Math.sign(d) * Math.min(Math.abs(d), dt * 7);
        if (t >= aim.fireAt && Math.abs(d) < 0.25) {
          aim.targeted = true;
          missiles.push({ x: C + Math.cos(shipAngle) * 12, y: C + Math.sin(shipAngle) * 12, angle: shipAngle, target: aim, age: 0 });
        }
      }
      // Missiles chase their bug
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        m.age += dt;
        const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        m.angle += Math.sign(turnBetween(m.angle, want)) * Math.min(Math.abs(turnBetween(m.angle, want)), dt * 6);
        m.x += Math.cos(m.angle) * 170 * dt;
        m.y += Math.sin(m.angle) * 170 * dt;
        if (Math.hypot(m.target.x - m.x, m.target.y - m.y) < 7 || m.age > 4) {
          booms.push({ x: m.target.x, y: m.target.y, age: 0 });
          const k = bugs.indexOf(m.target);
          if (k >= 0) bugs.splice(k, 1);
          missiles.splice(i, 1);
          setKills((n) => n + 1);
        }
      }
      for (let i = booms.length - 1; i >= 0; i--) { booms[i].age += dt; if (booms[i].age > 0.6) booms.splice(i, 1); }
    };

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Screen
      const bg = ctx.createRadialGradient(C, C, 0, C, C, R);
      bg.addColorStop(0, '#052e16');
      bg.addColorStop(1, '#021208');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fill();
      // Rings and cross hairs
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.28)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(C, C, (R * i) / 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(C - R, C); ctx.lineTo(C + R, C); ctx.moveTo(C, C - R); ctx.lineTo(C, C + R); ctx.stroke();
      // Sweep: a fading wedge behind a bright line
      for (let i = 0; i < 24; i++) {
        const a0 = sweep - i * 0.04;
        ctx.fillStyle = `rgba(74, 222, 128, ${0.22 * (1 - i / 24)})`;
        ctx.beginPath(); ctx.moveTo(C, C); ctx.arc(C, C, R, a0 - 0.04, a0); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(134, 239, 172, 0.9)';
      ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(C + Math.cos(sweep) * R, C + Math.sin(sweep) * R); ctx.stroke();
      // Bugs: pulsing red blips with a ring that spreads out
      for (const b of bugs) {
        const pulse = (t * 2 + b.phase) % 1;
        const appear = Math.min(1, (t - b.born) * 4);
        ctx.strokeStyle = `rgba(248, 113, 113, ${(1 - pulse) * 0.8 * appear})`;
        ctx.beginPath(); ctx.arc(b.x, b.y, 3 + pulse * 11, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.5 * appear, 0, Math.PI * 2); ctx.fill();
        // tiny wiggling legs so it looks like a bug
        ctx.strokeStyle = '#fca5a5';
        const w = Math.sin(t * 14 + b.phase) * 1.5;
        ctx.beginPath();
        ctx.moveTo(b.x - 3, b.y - 2); ctx.lineTo(b.x - 6, b.y - 4 + w);
        ctx.moveTo(b.x + 3, b.y - 2); ctx.lineTo(b.x + 6, b.y - 4 - w);
        ctx.moveTo(b.x - 3, b.y + 2); ctx.lineTo(b.x - 6, b.y + 4 - w);
        ctx.moveTo(b.x + 3, b.y + 2); ctx.lineTo(b.x + 6, b.y + 4 + w);
        ctx.stroke();
      }
      // Missiles: flashing triangles with a short trail
      for (const m of missiles) {
        const on = Math.floor(m.age * 14) % 2 === 0;
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - Math.cos(m.angle) * 16, m.y - Math.sin(m.angle) * 16); ctx.stroke();
        ctx.fillStyle = on ? '#fde047' : '#ffffff';
        triangle(ctx, m.x, m.y, m.angle, 5); ctx.fill();
      }
      // Explosions
      for (const e of booms) {
        const p = e.age / 0.6;
        ctx.strokeStyle = `rgba(253, 224, 71, ${1 - p})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, 4 + p * 16, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(248, 113, 113, ${1 - p})`;
        ctx.beginPath(); ctx.arc(e.x, e.y, 2 + p * 9, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      // The player's ship
      ctx.fillStyle = '#4ade80';
      triangle(ctx, C, C, shipAngle, 9); ctx.fill();
      ctx.fillStyle = '#052e16';
      ctx.beginPath(); ctx.arc(C, C, 2, 0, Math.PI * 2); ctx.fill();
      // Rim
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    };

    if (reduceMotion) {
      // For people who prefer less movement: one still picture
      spawnBug(); spawnBug();
      draw();
      return;
    }

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); // never jump far after a pause
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} role="img" aria-label="Radar game: a ship shoots missiles at red bugs" className="mx-auto aspect-square w-full" style={{ maxWidth }} />
      <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">Bugs squashed: <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{kills}</span> · High score: <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{best}</span></p>
    </div>
  );
}
