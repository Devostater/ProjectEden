import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Wifi, Check, Copy, Smartphone, Globe, KeyRound } from 'lucide-react';

interface PairingInfo {
  code: string;
  addresses: string[];
}

// A QR code the phone's camera can open: the link carries the pairing code, so one scan pairs it.
const QR: React.FC<{ text: string }> = ({ text }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 220, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [text]);
  return src ? <img src={src} alt="QR code: scan it with your phone's camera" width={180} height={180} className="rounded-lg bg-white p-1" /> : null;
};

// Remote: connect a phone or tablet without a cable, over Wi-Fi (or from anywhere with a private network
// such as Tailscale). Only the computer running the hub can see the code; on a phone this page shows nothing.
export const RemoteView: React.FC = () => {
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [mainLink, setMainLink] = useState<{ name: string; link: string } | null>(null);
  useEffect(() => {
    fetch('/api/device-hubs')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.main !== 'pc' && d.devices?.[d.main]?.link) setMainLink({ name: d.mainName || 'the device', link: d.devices[d.main].link });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/pairing')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setBlocked(true));
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(''), 2000);
    } catch {}
  };
  const reset = async () => {
    setConfirm(false);
    const d = await fetch('/api/pairing/reset', { method: 'POST' }).then((r) => r.json());
    setInfo(d);
  };

  const address = mainLink?.link || info?.addresses[chosen] || info?.addresses[0];
  const link = info && address ? `${address}/?pair=${info.code}` : '';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          <Wifi className="h-6 w-6 text-indigo-500" /> Remote
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Use the hub on your phone or tablet without a cable. For a cable connection, use the Devices tab.</p>
      </div>

      {blocked ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          The pairing code is only shown on the computer that runs the hub. Open this tab there. If you are on that computer already, reload the page; if it still shows this, restart the hub from Settings.
        </p>
      ) : !info ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Looking for your connection options…</p>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Smartphone className="h-5 w-5 text-indigo-500" /> Connect a phone or tablet on your Wi-Fi
            </h2>
            {mainLink && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{mainLink.name} is the main server, so this code opens the hub on it.</p>}
            {!address ? (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">This computer isn't on a network right now. Connect it to Wi-Fi, or use a USB cable (Devices tab).</p>
            ) : (
              <div className="mt-4 flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0 self-center sm:self-start">
                  <QR text={link} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
                    <li>Put the phone on the same Wi-Fi as this computer.</li>
                    <li>Point the phone's camera at the QR code and tap the link it shows.</li>
                    <li>It pairs by itself and stays paired. In Chrome, tap ⋮ → <b>Add to Home screen</b> to keep it like an app.</li>
                  </ol>
                  {!mainLink && info.addresses.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      Network:
                      {info.addresses.map((a, i) => (
                        <button key={a} onClick={() => setChosen(i)} aria-pressed={chosen === i} className={`rounded-md px-2 py-0.5 font-mono ${chosen === i ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
                          {a.replace(/^https?:\/\//, '')}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-950">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-800 dark:text-slate-200">{link}</code>
                    <button onClick={() => copy(link)} className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                      {copied === link ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} {copied === link ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">No camera? Send yourself the link, or open {address} on the phone and type the code below.</p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <KeyRound className="h-5 w-5 text-indigo-500" /> Pairing code
            </h2>
            <div className="mt-2 font-mono text-3xl tracking-[0.3em] text-slate-900 dark:text-white">{info.code}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Anyone on your network with this code (or the link) can use the hub. Don't share it.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              {confirm ? (
                <>
                  <span className="text-slate-600 dark:text-slate-300">Make a new code? Paired phones will need to scan again.</span>
                  <button onClick={reset} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500">New code</button>
                  <button onClick={() => setConfirm(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Keep</button>
                </>
              ) : (
                <button onClick={() => setConfirm(true)} className="text-slate-500 hover:underline">Make a new code (signs out paired phones)</button>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Globe className="h-5 w-5 text-indigo-500" /> Away from home
            </h2>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
              The hub only answers on your own network, so it isn't open to the internet. To use it from anywhere, install the free app{' '}
              <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">Tailscale</a>{' '}
              on this computer and your phone and sign in to both with the same account. Its address (starting with 100.) then appears above as another network: scan that one.
            </p>
          </section>
        </>
      )}
    </div>
  );
};
