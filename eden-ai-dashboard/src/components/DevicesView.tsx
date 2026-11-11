import React, { useEffect, useState } from 'react';
import { Tablet, Smartphone, Cable, Cpu, MemoryStick, BatteryMedium, ExternalLink, Unplug, Loader2, RefreshCw, Server, Wifi, Crown, Monitor, ChevronDown, Bot, Plus } from 'lucide-react';
import { api } from '../api.ts';
import { useBusy } from './BusyBanner.tsx';
import { RemoteDevices } from './RemoteDevices.tsx';
import { AddDevice } from './AddDevice.tsx';

interface Device {
  serial: string;
  state: string;
  model?: string;
  name?: string;
  android?: string;
  cores?: number;
  ramGb?: number;
  battery?: number;
  connected: boolean;
  auto: boolean;
  wifi?: boolean;
  wifiIp?: string;
}

interface DeviceHub {
  termux: boolean;
  running: boolean;
  link?: string;
  installing?: string;
  error?: string;
}
interface Hubs {
  main: string; // 'pc' or a device serial
  mainName?: string;
  devices: Record<string, DeviceHub>;
}

const isTablet = (d: Device) => /tab|pad|^SM-[XTP]/i.test(`${d.name || ''} ${d.model || ''}`);

export const DevicesView: React.FC = () => {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [adbFound, setAdbFound] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Folded cards (remembered on this browser).
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('eden_devices_folded') || '[]');
    } catch {
      return [];
    }
  });
  const toggleFold = (id: string) =>
    setFolded((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem('eden_devices_folded', JSON.stringify(next));
      } catch {}
      return next;
    });
  const foldButton = (id: string, name: string) => (
    <button onClick={() => toggleFold(id)} aria-expanded={!folded.includes(id)} aria-label={`${folded.includes(id) ? 'Show' : 'Hide'} details for ${name}`} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
      <ChevronDown className={`h-5 w-5 transition-transform ${folded.includes(id) ? '-rotate-90' : ''}`} />
    </button>
  );

  const [pc, setPc] = useState<{ name: string; cpu?: string; cores: number; ramGb: number; freeGb: number; cpuPercent: number; os: string } | null>(null);
  useEffect(() => {
    const loadPc = () => api<any>('GET', '/api/this-pc').then(setPc).catch(() => {});
    loadPc();
    const t = setInterval(() => document.visibilityState === 'visible' && loadPc(), 10000);
    return () => clearInterval(t);
  }, []);

  const [busyMode, setBusyMode] = useBusy();
  const [hubs, setHubs] = useState<Hubs | null>(null);
  const loadHubs = async (refresh = false) => {
    try {
      setHubs(await api<Hubs>('GET', `/api/device-hubs${refresh ? '?refresh=1' : ''}`));
    } catch {}
  };
  useEffect(() => {
    loadHubs();
    const t = setInterval(() => document.visibilityState === 'visible' && loadHubs(), 15000);
    return () => clearInterval(t);
  }, []);
  const hubAct = async (serial: string, action: string, done: string) => {
    setBusy(`${serial}:${action}`);
    setMessage(null);
    try {
      const r = await api<{ restarting?: boolean }>('POST', `/api/device-hubs/${encodeURIComponent(serial)}/${action}`);
      setMessage({ ok: true, text: r.restarting ? 'Data copied back. The hub is restarting; this page reloads by itself in a moment.' : done });
      if (r.restarting) setTimeout(() => window.location.reload(), 12000);
      await loadHubs(true);
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  const load = async () => {
    try {
      const d = await api<{ adb: boolean; devices: Device[] }>('GET', '/api/devices');
      setAdbFound(d.adb);
      setDevices(d.devices);
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    }
  };
  useEffect(() => {
    load();
    // Live: the hub tells this page the moment a device is plugged in or out. A slow check stays as a backup.
    let events: EventSource | null = null;
    try {
      events = new EventSource('/api/devices/events');
      events.onmessage = (e) => {
        if (e.data !== 'change') return;
        load();
        setTimeout(load, 2500); // again once it's connected
        setTimeout(() => loadHubs(true), 4000);
      };
    } catch {}
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => {
      clearInterval(t);
      events?.close();
    };
  }, []);
  const [adding, setAdding] = useState(false);

  const act = async (d: Device, action: string, done: string) => {
    setBusy(`${d.serial}:${action}`);
    setMessage(null);
    try {
      await api('POST', `/api/devices/${encodeURIComponent(d.serial)}/${action}`);
      setMessage({ ok: true, text: done });
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <Tablet className="h-6 w-6 text-indigo-500" /> Devices
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Your phones and tablets. Plugged-in devices connect by themselves and this page updates live.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            <Plus className="h-4 w-4" /> Add a device
          </button>
          <button onClick={load} aria-label="Look for devices again" className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {hubs && hubs.main !== 'pc' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <Crown className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <b>{hubs.mainName || 'A device'}</b> is the main server. AI on this PC is paused so the two don't work the same cards. Your live projects and chats are on the device.
          </span>
          <button onClick={() => hubAct('pc', 'make-pc-main', 'This PC is the main server again.')} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg border border-amber-400 px-3 py-1.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900/50">
            {busy === 'pc:make-pc-main' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />} Make this PC the main server
          </button>
        </div>
      )}

      {pc && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
              <Monitor className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-white">
                This PC <span className="font-normal text-slate-500">({pc.name})</span>
                {(!hubs || hubs.main === 'pc') && <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"><Crown className="h-3 w-3" /> Main server</span>}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Runs the hub at http://localhost:3000. CPU {pc.cpuPercent}% busy, {pc.freeGb} GB memory free.</p>
            </div>
            {foldButton('pc', 'This PC')}
          </div>
          {!folded.includes('pc') && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5"><Cpu className="h-4 w-4 text-slate-400" /> {pc.cores} cores</span>
                <span className="flex items-center gap-1.5"><MemoryStick className="h-4 w-4 text-slate-400" /> {pc.ramGb} GB memory ({pc.freeGb} GB free)</span>
                <span className="text-slate-500">{pc.os}</span>
              </div>
              {pc.cpu && <p className="text-xs text-slate-500">{pc.cpu}</p>}
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>CPU busy</span><span>{pc.cpuPercent}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${pc.cpuPercent > 85 ? 'bg-red-500' : pc.cpuPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pc.cpuPercent}%` }} /></div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Memory used</span><span>{Math.round(((pc.ramGb - pc.freeGb) / pc.ramGb) * 100)}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${pc.freeGb < 1.5 ? 'bg-red-500' : pc.freeGb < 3 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.round(((pc.ramGb - pc.freeGb) / pc.ramGb) * 100)}%` }} /></div>
              </div>
              <p className="flex items-start gap-1.5 text-slate-600 dark:text-slate-400"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> Only this PC can run Claude and ChatGPT (your subscriptions), Ollama, LYRA and Code updates.</p>
              {busyMode && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
                  <input type="checkbox" checked={busyMode.enabled} onChange={(e) => setBusyMode(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                  <span>
                    <span className="block font-medium text-slate-900 dark:text-white">
                      PC busy mode {busyMode.active ? <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Busy now: {busyMode.reason}</span> : busyMode.enabled ? <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">On, PC has room</span> : null}
                    </span>
                    <span className="block text-slate-600 dark:text-slate-400">When memory drops under 2.5 GB free or the CPU stays above 85%, code updates, LYRA and AI models on this PC wait so the PC stays usable. Cloud AIs keep working.</span>
                  </span>
                </label>
              )}
            </div>
          )}
        </section>
      )}

      {message && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
          {message.text}
        </p>
      )}

      {!adbFound && <p className="text-sm text-amber-700 dark:text-amber-300">The Android USB tool (adb) wasn't found on this computer. Install Android platform-tools, or run "Install LYRA AI on Tablet" once, then refresh.</p>}

      {devices === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking for devices…</p>
      ) : !devices.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <p className="font-medium text-slate-900 dark:text-white">No device found</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>On the phone, open <b>Settings → About phone → Software information</b> and tap <b>Build number</b> 7 times. "Developer mode" turns on.</li>
            <li>Go back to <b>Settings → Developer options</b> and turn on <b>USB debugging</b>.</li>
            <li>Plug it into this computer with a USB cable that carries data (not a charge-only cable).</li>
            <li>Unlock it and tap <b>Allow</b> on "Allow USB debugging?" (tick "Always allow from this computer").</li>
            <li>It appears here within a few seconds. Press <b>Connect over USB</b> once; after that it connects by itself.</li>
          </ol>
        </div>
      ) : (
        [...devices].map((d) => (
          <section key={d.serial} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                {isTablet(d) ? <Tablet className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-900 dark:text-white">{d.name || d.model || d.serial}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {d.state === 'device'
                    ? d.connected
                      ? 'Connected through the cable: open http://localhost:3000 on it.'
                      : 'Plugged in, not connected yet.'
                    : d.state === 'unauthorized'
                      ? 'Waiting for you to tap "Allow" on the device.'
                      : `Not ready (${d.state}).`}
                </p>
                {d.state === 'device' && !folded.includes(d.serial) && (
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {d.cores && <span className="flex items-center gap-1.5"><Cpu className="h-4 w-4 text-slate-400" /> {d.cores} cores</span>}
                    {d.ramGb && <span className="flex items-center gap-1.5"><MemoryStick className="h-4 w-4 text-slate-400" /> {d.ramGb} GB memory</span>}
                    {d.battery !== undefined && <span className="flex items-center gap-1.5"><BatteryMedium className="h-4 w-4 text-slate-400" /> {d.battery}%</span>}
                    {d.android && <span className="text-slate-500">Android {d.android}</span>}
                  </div>
                )}
              </div>
              <span className={`flex shrink-0 items-center gap-1.5 text-sm ${d.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                <Cable className="h-4 w-4" /> {d.connected ? 'Connected' : 'Not connected'}
              </span>
              {foldButton(d.serial, d.name || d.model || 'device')}
            </div>
            {!folded.includes(d.serial) && (<>

            {d.state === 'device' && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                {!d.connected ? (
                  <button onClick={() => act(d, 'connect', 'Connected. It will reconnect by itself whenever you plug it in.')} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                    {busy === `${d.serial}:connect` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />} Connect over USB
                  </button>
                ) : (
                  <>
                    <button onClick={() => act(d, 'open', 'Opened the hub on the device.')} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                      <ExternalLink className="h-4 w-4" /> Open the hub on it
                    </button>
                    <button onClick={() => act(d, 'open-lyra', 'Opened LYRA on the device.')} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                      <ExternalLink className="h-4 w-4" /> Open LYRA on it
                    </button>
                    <button onClick={() => act(d, 'disconnect', 'Disconnected. It will use Wi-Fi and the pairing code again, and stays off until you press Connect.')} disabled={!!busy} className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800">
                      <Unplug className="h-4 w-4" /> Disconnect
                    </button>
                  </>
                )}
              </div>
            )}
            {d.state === 'device' && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
                <Wifi className={`h-4 w-4 ${d.wifi ? 'text-emerald-500' : 'text-slate-400'}`} />
                <span className="flex-1 text-slate-700 dark:text-slate-300">{d.wifi ? 'Paired for Wi-Fi too: it keeps working when you unplug it (on the same Wi-Fi).' : 'Not paired for Wi-Fi yet: it only works while plugged in.'}</span>
                <button onClick={() => act(d, 'setup-wifi', 'Opened the Wi-Fi link on the device. It is paired for Wi-Fi now.')} disabled={!!busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  {d.wifi ? 'Pair again' : 'Set up Wi-Fi'}
                </button>
              </div>
            )}

            {d.state === 'device' && hubs && (() => {
              const h = hubs.devices[d.serial];
              const isMain = hubs.main === d.serial;
              if (!h) return null;
              return (
                <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-950/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <Server className="h-4 w-4 text-indigo-500" />
                    <span className="font-medium text-slate-900 dark:text-white">Hub on this device</span>
                    {isMain && <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"><Crown className="h-3 w-3" /> Main server</span>}
                    <span className={`ml-auto text-xs ${h.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                      {h.installing ? 'Installing…' : h.running ? 'Running' : h.termux ? 'Installed, not running' : 'Not installed'}
                    </span>
                  </div>
                  {h.installing ? (
                    <p className="mt-2 flex items-center gap-2 text-slate-700 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> {h.installing} Keep it plugged in and unlocked.</p>
                  ) : h.running ? (
                    <div className="mt-2 space-y-2">
                      {h.link && <p className="text-slate-600 dark:text-slate-400">Other phones on your Wi-Fi can open it at <code className="font-mono text-slate-800 dark:text-slate-200">{h.link}</code> (same pairing code).</p>}
                      {!isMain && (
                        <button onClick={() => hubAct(d.serial, 'make-main', `${d.name || 'The device'} is now the main server.`)} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                          {busy === `${d.serial}:make-main` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />} Make it the main server
                        </button>
                      )}
                      <p className="text-xs text-slate-500">As the main server it uses Gemini, Google AI Studio and free AIs with keys. Claude, ChatGPT and Ollama stay on this PC.</p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {h.error && <p className="text-red-600 dark:text-red-400">{h.error}</p>}
                      <p className="text-slate-600 dark:text-slate-400">
                        {h.termux ? 'The hub is installed but not running. Open Termux on the device to start it, or install again to update it.' : 'Runs the hub on the device itself, so it can be the main server. Installs the free Termux app and Node (about 150 MB, a few minutes).'}
                      </p>
                      <button onClick={() => hubAct(d.serial, 'install', 'Installing the hub on the device. This takes a few minutes.')} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                        <Server className="h-4 w-4" /> {h.termux ? 'Install / update the hub' : 'Install hub on this device'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Through the cable the device counts as this computer, so anyone holding it can use the hub without the pairing code.</p>
            </>)}
          </section>
        ))
      )}

      {!!devices?.length && (
        <details className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <summary className="cursor-pointer font-medium text-slate-900 dark:text-white">Add another phone or tablet</summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5">
            <li>On the phone, open <b>Settings → About phone → Software information</b> and tap <b>Build number</b> 7 times. "Developer mode" turns on.</li>
            <li>Go back to <b>Settings → Developer options</b> and turn on <b>USB debugging</b>.</li>
            <li>Plug it into this computer with a USB cable that carries data (not a charge-only cable).</li>
            <li>Unlock it and tap <b>Allow</b> on "Allow USB debugging?" (tick "Always allow from this computer").</li>
            <li>It appears here within a few seconds. Press <b>Connect over USB</b> once; after that it connects by itself.</li>
          </ol>
        </details>
      )}

      <RemoteDevices folded={folded} onToggle={toggleFold} usb={(devices || []).filter((d) => d.wifiIp).map((d) => ({ ip: d.wifiIp!, name: d.name || d.model || 'USB device' }))} />
      {adding && <AddDevice devices={devices || []} onClose={() => setAdding(false)} />}
    </div>
  );
};
