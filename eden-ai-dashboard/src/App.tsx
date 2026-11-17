import { THEMES, loadTheme, applyTheme } from './themes.ts';
import { textScale, rootPx, useTextSize } from './textSize.ts'; // first: sets the saved text size before anything paints
import React, { useState, useEffect, useRef } from 'react';
import { Sidebar, type AppTab, type SidebarRequest } from './components/Sidebar.tsx';
import { HomeView } from './components/HomeView.tsx';
import { MyAIView } from './components/MyAIView.tsx';
import { PipelineDAGView } from './components/PipelineDAGView.tsx';
import { FilesVaultView } from './components/FilesVaultView.tsx';
import { ChatView, type ChatDraft } from './components/ChatView.tsx';
import { AccountView, type AccountTab } from './components/AccountView.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { ProjectSidePanel } from './components/ProjectSidePanel.tsx';
import { BoardInsights } from './components/ProjectPages.tsx';
import { NexusView } from './components/NexusView.tsx';
import { UpdatesView } from './components/UpdatesView.tsx';
import { DevicesView } from './components/DevicesView.tsx';
import { MeetingsView } from './components/MeetingsView.tsx';
import { ReposView } from './components/ReposView.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import type { CommandActions } from './components/VoiceCommands.tsx';
import { TITLES } from './components/Header.tsx';
import { BusyBanner } from './components/BusyBanner.tsx';
import { OfflineBanner } from './components/Offline.tsx';
import { UsageWarningBanner } from './components/UsageWarning.tsx';
import { RemoteView } from './components/RemoteView.tsx';
import { MobileNav } from './components/MobileNav.tsx';
import { MobilePanel } from './components/MobilePanel.tsx';
import { MobileMenu } from './components/MobileMenu.tsx';
import { PageTiles } from './pages.tsx';
import { usePanes, readKeep, saveKeep, paneToClose, type KeepPage } from './panes.ts';
import { PaneFrame, PaneSwitch, SplitHandle } from './components/PaneFrame.tsx';
import { ActiveWorkers, PauseAndWorkers } from './components/ActiveWorkers.tsx';
import { openPanel } from './panel.ts';
import { PROJECT_PANELS } from './panelMeta.ts';
import { roadmapProgress } from './components/Roadmap.tsx';
import type { PanelProject } from './components/BottomPanel.tsx';
import type { ReviewProps } from './components/ReviewTab.tsx';
import { useNexusRooms } from './nexusRooms.ts';
import { OUTDATED_EVENT } from './api.ts';
import type { Agent, DAGPipeline, HostedFile } from './types/index.ts';
import { useChatThreads } from './chatThreads.ts';
import { useProjects } from './projectsStore.ts';
import { ProjectsView } from './components/ProjectsView.tsx';

// Once per device: open the bottom dock taller than the old 256px so it can be read (about 22rem at the chosen
// text size, at most 45% of the window). A taller height you already saved is kept; you can still drag it.
try {
  if (!localStorage.getItem('eden_panel_height_seeded')) {
    const want = Math.round(Math.min(22 * 16 * textScale(), window.innerHeight * 0.45));
    const saved = Number(localStorage.getItem('eden_panel_height')) || 256;
    localStorage.setItem('eden_panel_height', String(Math.max(saved, want)));
    localStorage.setItem('eden_panel_height_seeded', '1');
  }
} catch {}

export default function App() {
  // Eden theme (Account → Preferences). darkMode / setDarkMode stay for the voice commands ("dark mode", "light mode").
  const [theme, setTheme] = useState<string>(loadTheme);
  const darkMode = THEMES.find((t) => t.id === theme)?.dark ?? true;
  const setDarkMode = (v: boolean | ((now: boolean) => boolean)) => {
    const dark = typeof v === 'function' ? v(darkMode) : v;
    if (dark !== darkMode) setTheme(dark ? 'dark' : 'light');
  };
  // One or two pages side by side (panes.ts). setActiveTab drives the pane you are in; reveal (links inside a page)
  // opens in the other pane when two are open.
  const { panes, focus, activeTab, split, picking, ratio, setRatio, navigate, reveal, openBeside, startPicking, cancelPicking, close, swap, setFocus, back } = usePanes();
  const [keepPage, setKeepPage] = useState<KeepPage>(readKeep);
  const setActiveTab = navigate;
  // Room for two pages side by side: two 22rem panes plus the bar between them (more room needed at larger text).
  const mainRef = useRef<HTMLElement>(null);
  const paneRowRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [textSize] = useTextSize();
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const check = () => setWide(el.clientWidth >= 44.75 * rootPx());
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [textSize]);
  // Esc leaves the page picker.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelPicking();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [pipelines, setPipelines] = useState<DAGPipeline[]>([]);
  const [files, setFiles] = useState<HostedFile[]>([]);

  const chat = useChatThreads();
  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // phone: the full-screen "All pages" menu
  const [workersOpen, setWorkersOpen] = useState(false); // "Active workers": every AI working right now
  // Shown when the page is newer than the running server (see api.ts).
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    const on = () => setOutdated(true);
    window.addEventListener(OUTDATED_EVENT, on);
    return () => window.removeEventListener(OUTDATED_EVENT, on);
  }, []);
  const nexusRooms = useNexusRooms();
  const [newRoomRequest, setNewRoomRequest] = useState(0);
  // Something the sidebar asked a page to open. The number makes repeat requests distinct.
  const [request, setRequest] = useState<(SidebarRequest & { n: number }) | null>(null);
  const [pipelineId, setPipelineId] = useState('');
  const [nexusFocus, setNexusFocus] = useState<{ roomId: string; seq: number; n: number } | null>(null);
  const [accountTab, setAccountTab] = useState<AccountTab>('account');
  const [profile, setProfile] = useState({ name: '', studio: '' });

  // Your name and studio name, for the sidebar and the Dashboard greeting.
  useEffect(() => {
    const ask = (e: Event) => { const text = (e as CustomEvent<string>).detail; if (text) openChat(text, false); };
    window.addEventListener('eden-ask', ask);
    return () => window.removeEventListener('eden-ask', ask);
  });
  const loadProfile = async () => {
    try {
      const d = await fetch('/api/settings').then((r) => r.json());
      const value = (key: string) => d.settings.find((s: any) => s.key === key)?.preview || '';
      setProfile({ name: value('OWNER_NAME'), studio: value('STUDIO_NAME') });
    } catch {}
  };
  useEffect(() => {
    loadProfile();
  }, []);

  const openAccount = (tab: AccountTab) => {
    setAccountTab(tab);
    reveal('settings');
  };
  const projectsApi = useProjects();

  // The number of cards waiting for your review, shown in the browser tab title.
  const reviewCount = projectsApi.cards.filter((c) => c.column === 'review').length;
  useEffect(() => {
    document.title = reviewCount > 0 ? `(${reviewCount}) Eden AI Hub` : 'Eden AI Hub';
  }, [reviewCount]);

  // A message handed to Chat from another page (Home's ask box, a teammate, a file).
  const [chatDraft, setChatDraft] = useState<ChatDraft | null>(null);
  const openChat = (text: string, send: boolean) => {
    setChatDraft({ text, send });
    reveal('chat');
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const refreshAllData = async () => {
    try {
      const res = await fetch('/api/workspace');
      if (!res.ok) return;
      const d = await res.json();
      if (d.agents) setAgents(d.agents);
      if (d.pipelines) setPipelines(d.pipelines);
      if (d.files) setFiles(d.files);
    } catch (err) {
      console.warn('Data load error:', err);
    }
  };

  useEffect(() => {
    refreshAllData();
  }, []);

  const post = async (url: string, body: unknown, method = 'POST') => {
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) await refreshAllData();
    } catch (err) {
      console.error(`${method} ${url} failed:`, err);
    }
  };

  const handleSaveAgent = (agent: Partial<Agent>) => post('/api/agents', agent);
  const handleSavePipeline = (pipeline: DAGPipeline) => post('/api/pipelines', pipeline);
  const handleSaveFile = (file: Partial<HostedFile>) =>
    file.id ? post(`/api/files/${file.id}`, file, 'PUT') : post('/api/files', file);

  const remove = async (url: string) => {
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) await refreshAllData();
    } catch (err) {
      console.error(`DELETE ${url} failed:`, err);
    }
  };

  const mention = (agent: Agent) => `@${agent.name.split(' ')[0]} `;


  // What the mic and the command box in the top bar can do (see commands.ts for what they understand).
  const ask = (r: SidebarRequest) => setRequest({ ...r, n: (request?.n || 0) + 1 });
  const commandActions: CommandActions = {
    go: setActiveTab,
    openAccount,
    openChat,
    setDark: (dark) => setDarkMode((now) => (dark === 'toggle' ? !now : dark)),
    newAziProject: (name) => {
      setActiveTab('projects');
      ask({ kind: 'new-azi-project', name });
    },
    create: (what) => {
      if (what === 'project') {
        setActiveTab('projects');
        ask({ kind: 'new-project' });
      } else if (what === 'teammate') {
        setActiveTab('my-ai');
        ask({ kind: 'new-teammate' });
      } else {
        setActiveTab('nexus');
        setNewRoomRequest((n) => n + 1);
      }
    },
    openProject: (id) => {
      projectsApi.setActiveId(id);
      setActiveTab('projects');
    },
    back,
    projects: projectsApi.projects.map((p) => ({ id: p.id, name: p.name })),
    agents: agents.map((a) => ({ name: a.name })),
  };

  // Everything waiting for your review, for the bottom panel (and the full-screen sheet on phones).
  const review: ReviewProps = {
    cards: projectsApi.cards.filter((c) => c.column === 'review'),
    projects: projectsApi.projects,
    agents,
    onApprove: (ids) => projectsApi.approveCards(ids),
    onSendBack: (id, note) => projectsApi.sendBackCard(id, note),
    onOpen: (card) => {
      projectsApi.setActiveId(card.projectId);
      projectsApi.setOpenCardId(card.id);
      setActiveTab('projects');
    },
  };


// The open project's data for the bottom bar's project tabs (and the phone's full-screen sheets).
  const renderMyAI = () => (
              <MyAIView
                onTeamChanged={refreshAllData}
                request={request?.kind === 'new-teammate' || request?.kind === 'edit-teammate' ? request : null}
                agents={agents}
                onSaveAgent={handleSaveAgent}
                onDeleteAgent={async (id) => {
                  await remove(`/api/agents/${id}`);
                  await projectsApi.refresh();
                }}
                onSelectAgentForSwarm={(id) => {
                  const agent = agents.find((a) => a.id === id);
                  if (agent) openChat(mention(agent), false);
                }}
              />
  );
  const panelProject: PanelProject | null = projectsApi.active
    ? {
        project: projectsApi.active,
        cards: projectsApi.cards.filter((c) => c.projectId === projectsApi.active!.id && projectsApi.visible(c)),
        agents,
        onOpenCard: projectsApi.setOpenCardId,
        onSaveProject: async (p) => {
          await projectsApi.saveProject({ id: projectsApi.active!.id, ...p });
          await projectsApi.refresh();
        },
        onSaveRoadmap: async (roadmap) => {
          const id = projectsApi.active!.id;
          try {
            const r = await fetch(`/api/projects/${id}/roadmap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roadmap }) });
            if (!r.ok) projectsApi.setError((await r.json().catch(() => ({}))).error || 'Could not save the roadmap.');
          } catch {
            projectsApi.setError('Could not save the roadmap: the hub did not answer.');
          }
          await projectsApi.refresh();
        },
      }
    : null;

  // Any page, by id: the same JSX as before, now drawn in whichever pane shows it. A plain function (not a
  // component), so pages never remount when the layout changes.
  const renderPage = (activeTab: AppTab): React.ReactNode => (
    <>
            {activeTab === 'home' && (
              <HomeView
                onRetryCard={retryCard}
                agents={agents}
                pipelines={pipelines}
                files={files}
                projects={projectsApi.projects}
                cards={projectsApi.cards}
                onOpenProject={(id) => {
                  projectsApi.setActiveId(id);
                  reveal('projects');
                }}
                onAsk={(text) => openChat(text, true)}
                onTalkTo={(agent) => openChat(mention(agent), false)}
                ownerName={profile.name}
                onOpen={(tab) => (tab === 'settings' ? openAccount('connections') : reveal(tab))}
              />
            )}
  
            {activeTab === 'projects' && <ProjectsView below={panelProject && <BoardInsights {...panelProject} />} api={projectsApi} agents={agents} onAsk={(text) => openChat(text, false)} newProjectRequest={request?.kind === 'new-project' ? request.n : 0}
                aziProjectRequest={request?.kind === 'new-azi-project' ? { name: request.name, n: request.n } : null}
                onOpenBudgets={() => openAccount('connections')}
                onOpenSource={(card) => {
                  if (!card.source?.roomId) return;
                  setNexusFocus({ roomId: card.source.roomId, seq: card.source.messageSeq || 0, n: (nexusFocus?.n || 0) + 1 });
                  reveal('nexus');
                }}
              />}
  
            {activeTab === 'nexus' && (
              <NexusView
                roomsApi={nexusRooms}
                newRoomRequest={newRoomRequest}
                agents={agents}
                projects={projectsApi.projects}
                ownerName={profile.name}
                cards={projectsApi.cards}
                focus={nexusFocus}
                onOpenCard={(card) => {
                  projectsApi.setActiveId(card.projectId);
                  projectsApi.setOpenCardId(card.id);
                  reveal('projects');
                }}
                onMakeCards={(projectId, goal, source) => {
                  projectsApi.setActiveId(projectId);
                  projectsApi.setPlanRequest({ projectId, goal: `Turn this plan from the team discussion into cards:\n\n${goal}`, source: { kind: 'nexus', ...source } });
                  reveal('projects');
                }}
              />
            )}
  
            {activeTab === 'chat' && (
              <div className="h-full p-2 md:p-4">
                <ChatView agents={agents} chat={chat} draft={chatDraft} onDraftUsed={() => setChatDraft(null)} />
              </div>
            )}
  
            {activeTab === 'my-ai' && renderMyAI()}
  
            {activeTab === 'pipelines' && (
              <PipelineDAGView pipelines={pipelines} agents={agents} onSavePipeline={handleSavePipeline} onRefreshData={refreshAllData} openId={request?.kind === 'open-workflow' ? request.id : ''} openNonce={request?.n || 0} onSelected={setPipelineId} />
            )}
  
            {activeTab === 'files' && (
              <FilesVaultView
                files={files}
                onSaveFile={handleSaveFile}
                onDeleteFile={(id) => remove(`/api/files/${id}`)}
                onSendFileToSwarm={(file) =>
                  openChat(`About ${file.name}:\n\n${file.content.slice(0, 6000)}\n\nMy question: `, false)
                }
              />
            )}
  
            {activeTab === 'updates' && <UpdatesView />}
  
            {activeTab === 'repos' && <ReposView />}
            {activeTab === 'meetings' && <MeetingsView onOpenProject={(id) => { projectsApi.setActiveId(id); setActiveTab('projects'); }} />}
            {activeTab === 'devices' && <DevicesView />}
  
            {activeTab === 'remote' && <RemoteView />}
  
            {activeTab === 'settings' && (
              <AccountView
                tab={accountTab}
                setTab={setAccountTab}
                team={renderMyAI()}
                workflows={<PipelineDAGView pipelines={pipelines} agents={agents} onSavePipeline={handleSavePipeline} onRefreshData={refreshAllData} openId={request?.kind === 'open-workflow' ? request.id : ''} openNonce={request?.n || 0} onSelected={setPipelineId} />}
                darkMode={darkMode}
                setDarkMode={setDarkMode}
                theme={theme}
                setTheme={setTheme}
                onSaved={() => {
                  refreshAllData();
                  loadProfile();
                }}
              />
            )}
    </>
  );

  // Only a card that is still stuck on its failure goes back to Ready; one you already moved is left alone.
  const retryCard = async (id: string) => {
    const card = projectsApi.cards.find((c) => c.id === id);
    if (!card || card.runState !== 'failed') return false;
    return !!(await projectsApi.saveCard({ id, column: 'ready' }));
  };

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-slate-100 font-sans text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        chat={chat}
        rooms={nexusRooms}
        projects={projectsApi}
        pipelines={pipelines}
        activePipelineId={pipelineId}
        agents={agents}
        onNewRoom={() => setNewRoomRequest((n) => n + 1)}
        onRequest={(r) => setRequest({ ...r, n: (request?.n || 0) + 1 })} profile={profile} mobileOpen={drawer} onCloseMobile={() => setDrawer(false)} />

      <div className="relative flex h-[100dvh] min-w-0 flex-1 flex-col overflow-hidden">
        <div className="eden-bg" aria-hidden="true">
          <div className="eden-grid" />
        </div>

        {outdated && (
          <div role="alert" className="relative z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100">
            <span className="min-w-0 flex-1">
              <b>The hub needs a restart.</b> The page has been updated but the hub on your computer is still running the old version, so some things won't work. Close and reopen Start Eden.
            </span>
            <button onClick={() => window.location.reload()} className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-500">
              I've restarted it
            </button>
            <button onClick={() => setOutdated(false)} className="text-sm underline">Hide</button>
          </div>
        )}

        <StatusBar keepPage={keepPage} onKeepPage={(v) => { saveKeep(v); setKeepPage(v); }} title={split && wide ? '' : TITLES[activeTab] || ''} split={split || picking} onToggleSplit={() => (split ? close(paneToClose(keepPage, focus)) : picking ? cancelPicking() : startPicking())} setActiveTab={setActiveTab} darkMode={darkMode} setDarkMode={setDarkMode} reviewCount={reviewCount} actions={commandActions} />

        <main ref={mainRef} className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0">
            <OfflineBanner />
            <UsageWarningBanner />
            <BusyBanner />
          </div>
          {split && !wide && <PaneSwitch panes={panes} focus={focus} onFocus={setFocus} onCloseOther={() => close(paneToClose(keepPage, focus))} />}
          <div ref={paneRowRef} className="flex min-h-0 flex-1 overflow-hidden">
            {/* Drawn in a fixed order and placed with CSS order, so opening, swapping or closing never remounts the page that stays. */}
            {[...panes].sort().map((tab) => {
              const i = panes.indexOf(tab) as 0 | 1;
              const share = split && wide ? (i === 0 ? ratio : 1 - ratio) : 1;
              return (
                <PaneFrame
                  key={tab}
                  tab={tab}
                  order={i * 2}
                  flex={`${share} 1 0%`}
                  showHeader={split && wide}
                  focused={split && i === focus}
                  hidden={(split && !wide && i !== focus) || (picking && !wide)}
                  onFocus={() => setFocus(i)}
                  onSwap={swap}
                  onClose={() => close(i)}
                >
                  {renderPage(tab)}
                </PaneFrame>
              );
            })}
            {!split && !picking && activeTab === 'projects' && panelProject && <ProjectSidePanel project={panelProject} />}
            {split && wide && <SplitHandle ratio={ratio} setRatio={setRatio} containerRef={paneRowRef} />}
            {picking && wide && <div style={{ order: 1 }} className="w-3 shrink-0 bg-slate-200 dark:bg-slate-800" aria-hidden />}
            {picking && (
              <section key="picker" aria-label="Pick a page" style={{ order: 2, flex: '1 1 0%' }} className="min-w-0 overflow-y-auto bg-white p-4 dark:bg-slate-900">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Pick a page to open here</h2>
                <p className="mt-1 text-base text-slate-700 dark:text-slate-200">You can also choose one from the bar on the left.</p>
                <div className="mt-4">
                  <PageTiles current={[panes[0]]} reviewCount={reviewCount} onPick={openBeside} />
                </div>
                <button onClick={cancelPicking} className="mt-4 min-h-11 rounded-lg border-2 border-slate-300 px-4 text-base font-medium text-slate-800 dark:border-slate-600 dark:text-slate-100">
                  Cancel
                </button>
              </section>
            )}
          </div>
        </main>

        <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} onMore={() => setMenuOpen(true)} moreOpen={menuOpen} reviewCount={reviewCount} />
        <MobilePanel review={review} project={panelProject} onGoProjects={() => setActiveTab('projects')} />
        <ActiveWorkers
          open={workersOpen}
          onClose={() => setWorkersOpen(false)}
          cards={projectsApi.cards}
          projects={projectsApi.projects}
          agents={agents}
          rooms={nexusRooms.rooms}
          onOpenCard={(card) => {
            projectsApi.setActiveId(card.projectId);
            projectsApi.setOpenCardId(card.id);
            setActiveTab('projects');
          }}
          onOpenRoom={(id) => {
            nexusRooms.setActiveId(id);
            setActiveTab('nexus');
          }}
          onOpenUpdates={() => setActiveTab('updates')}
          onOpenLyra={() => openPanel('lyra')}
        />
        <MobileMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          activeTab={activeTab}
          go={setActiveTab}
          reviewCount={reviewCount}
          projects={projectsApi.projects.map((p) => ({ id: p.id, name: p.name }))}
          activeProjectId={projectsApi.activeId}
          onPickProject={(id) => {
            projectsApi.setActiveId(id);
            setActiveTab('projects');
          }}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          onOpenDrawer={() => setDrawer(true)}
          extraPanels={
            projectsApi.active
              ? PROJECT_PANELS.map((p) => ({ id: p.id, label: p.id === 'roadmap' && roadmapProgress(projectsApi.active!.roadmap) ? `Roadmap ${roadmapProgress(projectsApi.active!.roadmap)!.pct}%` : p.label, icon: p.icon, open: () => openPanel(p.id) }))
              : []
          }
          extraTitle={projectsApi.active ? `This project: ${projectsApi.active.name}` : undefined}
        />

        <div className="eden-dock contents">
        <BottomPanel
          onOpenPreferences={() => openAccount('preferences')}
          onRetryCard={retryCard}
          review={review}
          project={panes.includes('projects') ? panelProject : null}
          working={projectsApi.cards.filter((c) => c.runState === 'running').length + nexusRooms.rooms.filter((r) => r.running).length}
          onOpenWorkers={() => setWorkersOpen(true)}
        />
        </div>
      </div>
    </div>
  );
}
