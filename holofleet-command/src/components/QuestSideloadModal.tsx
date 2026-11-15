import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    triggerInstall,
  };
}

interface QuestSideloadModalProps {
  open: boolean;
  onClose: () => void;
}

export const QuestSideloadModal: React.FC<QuestSideloadModalProps> = ({ open, onClose }) => {
  const { isInstallable, isInstalled, triggerInstall } = usePWAInstall();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!open) return null;

  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-app-url.run.app';

  const bubblewrapCmds = `# 1. Install Meta Quest / Android TWA Packager
npm install -g @bubblewrap/cli

# 2. Initialize Quest 3 WebXR APK from live manifest
mkdir aether-quest-apk && cd aether-quest-apk
bubblewrap init --manifest="${appUrl}/manifest.webmanifest"

# 3. Build signed APK & Sideload to Quest 3 over USB-C
bubblewrap build
adb devices
adb install -r app-release-signed.apk`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadQuestManifest = () => {
    const questTwaConfig = {
      packageId: 'com.aetherroom.xr.quest3',
      host: typeof window !== 'undefined' ? window.location.host : 'localhost:3000',
      name: 'Aether Room XR',
      launcherName: 'AetherXR',
      display: 'standalone',
      orientation: 'landscape',
      themeColor: '#040812',
      navigationColor: '#040812',
      backgroundColor: '#040812',
      enableNotifications: false,
      startUrl: '/',
      iconUrl: `${appUrl}/pwa-512x512.png`,
      maskableIconUrl: `${appUrl}/pwa-maskable-512x512.png`,
      webManifestUrl: `${appUrl}/manifest.webmanifest`,
      metaQuestFeatures: {
        passthroughRequired: true,
        handTrackingSupported: true,
        xrSpatialTracking: true,
      },
    };
    const blob = new Blob([JSON.stringify(questTwaConfig, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'twa-manifest-quest3.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quest-sideload-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#020611]/88 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-[#060e20] border border-cyan-500/45 rounded-2xl p-6 shadow-2xl text-slate-100">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs font-semibold tracking-wider text-cyan-400">
              META QUEST 3 DEPLOYMENT &amp; SIDELOADING ASSISTANT
            </div>
            <h2
              id="quest-sideload-title"
              className="font-display text-xl md:text-2xl font-bold text-white mt-0.5"
            >
              Sideload &amp; Run on Meta Quest 3
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quest Sideload Guide"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 my-4 text-xs leading-relaxed">
          {/* Option 1: Direct Quest Browser PWA & WebXR Passthrough */}
          <div className="p-4 rounded-xl bg-[#09152b] border border-cyan-500/30">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-display text-sm font-bold text-cyan-300">
                Method 1: Instant Quest 3 Browser Install (No Cable Required)
              </h3>
              {isInstallable && !isInstalled && (
                <button
                  type="button"
                  onClick={triggerInstall}
                  className="px-3 py-1.5 rounded-lg bg-cyan-400 text-slate-950 font-bold text-xs hover:bg-cyan-300 cursor-pointer whitespace-nowrap"
                >
                  Install Standalone WebApp Now
                </button>
              )}
            </div>
            <p className="text-slate-300">
              1. Put on your <strong>Meta Quest 3</strong> and open the <strong>Meta Quest Browser</strong>.<br />
              2. Navigate to this app&apos;s URL (<code className="text-cyan-300 font-mono-num">{appUrl}</code>).<br />
              3. Click the <strong>Install App</strong> icon in the address bar (or click <strong>Enter XR Passthrough</strong> inside the HUD) to pin Aether Room XR directly to your Quest App Library with full color passthrough &amp; Touch Plus controller raycasting.
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(appUrl, 'url')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold cursor-pointer whitespace-nowrap"
              >
                {copiedKey === 'url' ? 'Copied App URL!' : 'Copy App URL for Quest Browser'}
              </button>
            </div>
          </div>

          {/* Option 2: Native APK Packaging & ADB / SideQuest Sideloading */}
          <div className="p-4 rounded-xl bg-[#091326] border border-slate-700/90">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-display text-sm font-bold text-amber-300">
                Method 2: Build Native `.apk` &amp; Sideload via SideQuest or ADB
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadQuestManifest}
                  className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold text-xs hover:bg-amber-300 cursor-pointer whitespace-nowrap"
                >
                  Download Quest 3 Config (.json)
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(bubblewrapCmds, 'cmds')}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer whitespace-nowrap"
                >
                  {copiedKey === 'cmds' ? 'Copied Commands!' : 'Copy ADB Commands'}
                </button>
              </div>
            </div>
            <p className="text-slate-300 mb-2">
              This app is configured with a compliant <strong>WebXR PWA Manifest</strong>. You can wrap it into a signed Android/Quest `.apk` using Meta&apos;s supported <code>@bubblewrap/cli</code> or <strong>PWABuilder (Meta Quest target)</strong> and install it under <em>App Library → Unknown Sources</em>:
            </p>
            <pre className="p-3 rounded-lg bg-[#040812] border border-slate-800 text-[11px] font-mono-num text-cyan-200 overflow-x-auto">
              {bubblewrapCmds}
            </pre>
            <p className="text-slate-400 mt-2">
              <strong>Using SideQuest GUI:</strong> Open SideQuest on your PC with your Quest 3 connected in Developer Mode, click the <strong>&ldquo;Install APK file from folder on computer&rdquo;</strong> icon in the top bar, and select <code>app-release-signed.apk</code>.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-display text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 cursor-pointer"
          >
            Got It — Back to Command
          </button>
        </div>
      </div>
    </div>
  );
};
