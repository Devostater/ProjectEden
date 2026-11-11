import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Cable, Wifi, Loader2, CheckCircle2, Smartphone, ArrowLeft } from 'lucide-react';
import { QR } from './RemoteView.tsx';

interface Dev {
  serial: string;
  state: string;
  name?: string;
  model?: string;
  connected: boolean;
}

// "Add a device": pick USB or Wi-Fi, follow two or three steps, and the hub connects it by itself.
// The USB path watches the live device list and moves on as soon as the device shows up.
export const AddDevice: React.FC<{ devices: Dev[]; onClose: () => void }> = ({ devices, onClose }) => {
  const [way, setWay] = useState<'' | 'usb' | 'wifi'>('');
  const known = useRef(new Set(devices.map((d) => d.serial))); // devices already there when this opened
  const fresh = devices.find((d) => !known.current.has(d.serial));
  const [pair, setPair] = useState<{ code: string; addresses: string[] } | null>(null);

  useEffect(() => {
    if (way === 'wifi' && !pair) fetch('/api/pairing').then((r) => (r.ok ? r.json() : null)).then(setPair).catch(() => {});
  }, [way]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const name = fresh ? fresh.name || fresh.model || 'Your device' : '';
  const link = pair?.addresses[0] ? `${pair.addresses[0]}/?pair=${pair.code}` : '';

  // Drawn on top of everything (the phone tab bar included).
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Add a device" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-2">
          {way && (
            <button onClick={() => setWay('')} aria-label="Back" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowLeft className="h-5 w-5" /></button>
          )}
          <h2 className="flex-1 text-lg font-semibold text-slate-900 dark:text-white">Add a device</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        {!way && (
          <div className="space-y-3">
            <button onClick={() => setWay('usb')} className="flex w-full items-start gap-3 rounded-xl border-2 border-slate-200 p-4 text-left hover:border-indigo-400 dark:border-slate-700">
              <Cable className="mt-0.5 h-6 w-6 shrink-0 text-indigo-500" />
              <span>
                <span className="block font-medium text-slate-900 dark:text-white">With a USB cable (Android)</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">Fastest and most reliable. No Wi-Fi or code needed, and it reconnects by itself. Also pairs it for Wi-Fi.</span>
              </span>
            </button>
            <button onClick={() => setWay('wifi')} className="flex w-full items-start gap-3 rounded-xl border-2 border-slate-200 p-4 text-left hover:border-indigo-400 dark:border-slate-700">
              <Wifi className="mt-0.5 h-6 w-6 shrink-0 text-indigo-500" />
              <span>
                <span className="block font-medium text-slate-900 dark:text-white">Over Wi-Fi (any phone, iPhone too)</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">Scan a QR code with the camera. Works on the same Wi-Fi as this PC.</span>
              </span>
            </button>
          </div>
        )}

        {way === 'usb' &&
          (fresh?.state === 'device' && fresh.connected ? (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <p className="text-lg font-medium text-slate-900 dark:text-white">{name} is connected</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">The hub opened on it, paired for Wi-Fi too. It reconnects by itself whenever you plug it in.</p>
              <button onClick={onClose} className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-500">Done</button>
            </div>
          ) : fresh?.state === 'unauthorized' ? (
            <div className="space-y-3 text-center">
              <Smartphone className="mx-auto h-12 w-12 text-amber-500" />
              <p className="text-lg font-medium text-slate-900 dark:text-white">Found it. One last step:</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">Unlock the device and tap <b>Allow</b> on "Allow USB debugging?". Tick "Always allow from this computer".</p>
              <p className="flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Waiting…</p>
            </div>
          ) : fresh ? (
            <p className="flex items-center justify-center gap-2 py-6 text-slate-600 dark:text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /> Connecting {name}…</p>
          ) : (
            <div className="space-y-3">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
                <li>
                  First time only: on the device open <b>Settings → About phone → Software information</b> and tap <b>Build number</b> 7 times. Then in <b>Settings → Developer options</b> turn on <b>USB debugging</b>.
                </li>
                <li>Plug it into this PC with a cable that carries data (not a charge-only cable).</li>
              </ol>
              <p className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" /> Watching for it… this updates the moment it's plugged in.
              </p>
            </div>
          ))}

        {way === 'wifi' && (
          <div className="space-y-3 text-center">
            {link ? (
              <>
                <div className="flex justify-center"><QR text={link} /></div>
                <p className="text-sm text-slate-700 dark:text-slate-300">On the phone: join the same Wi-Fi as this PC, point the camera at the code, and tap the link. It pairs by itself and stays paired.</p>
                <p className="text-xs text-slate-500">To keep it like an app: in Chrome tap ⋮ → Add to Home screen (Safari: Share → Add to Home Screen).</p>
              </>
            ) : pair ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">This PC isn't on a network right now. Connect it to Wi-Fi, or use a USB cable.</p>
            ) : (
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
            )}
            <button onClick={onClose} className="w-full rounded-lg border border-slate-300 py-2.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Done</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
