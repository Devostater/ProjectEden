import React, { useState, useEffect } from 'react';
import { Sidebar, type AppTab } from './components/Sidebar.tsx';
import { HomeView } from './components/HomeView.tsx';
import { MyAIView } from './components/MyAIView.tsx';
import { PipelineDAGView } from './components/PipelineDAGView.tsx';
import { FilesVaultView } from './components/FilesVaultView.tsx';
import { ChatView, type ChatDraft } from './components/ChatView.tsx';
import { AccountView, type AccountTab } from './components/AccountView.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { NexusView } from './components/NexusView.tsx';
import type { Agent, DAGPipeline, HostedFile } from './types/index.ts';
import { useChatThreads } from './chatThreads.ts';
import { useProjects } from './projectsStore.ts';
import { ProjectsView } from './components/ProjectsView.tsx';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('nexus_theme') !== 'light');
  const [activeTab, setActiveTab] = useState<AppTab>('home');

  const [agents, setAgents] = useState<Agent[]>([]);
  const [pipelines, setPipelines] = useState<DAGPipeline[]>([]);
  const [files, setFiles] = useState<HostedFile[]>([]);

  const chat = useChatThreads();
  const [accountTab, setAccountTab] = useState<AccountTab>('account');
  const [profile, setProfile] = useState({ name: '', studio: '' });

  // Your name and studio name, for the sidebar and the Dashboard greeting.
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
    setActiveTab('settings');
  };
  const projectsApi = useProjects();

  // A message handed to Chat from another page (Home's ask box, a teammate, a file).
  const [chatDraft, setChatDraft] = useState<ChatDraft | null>(null);
  const openChat = (text: string, send: boolean) => {
    setChatDraft({ text, send });
    setActiveTab('chat');
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('nexus_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} chat={chat} profile={profile} />

      <div className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <div className="eden-bg" aria-hidden="true">
          <div className="eden-grid" />
        </div>

        <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
          {activeTab === 'home' && (
            <HomeView
              agents={agents}
              pipelines={pipelines}
              files={files}
              projects={projectsApi.projects}
              cards={projectsApi.cards}
              onOpenProject={(id) => {
                projectsApi.setActiveId(id);
                setActiveTab('projects');
              }}
              onAsk={(text) => openChat(text, true)}
              onTalkTo={(agent) => openChat(mention(agent), false)}
              ownerName={profile.name}
              onOpen={(tab) => (tab === 'settings' ? openAccount('connections') : setActiveTab(tab))}
            />
          )}

          {activeTab === 'projects' && <ProjectsView api={projectsApi} agents={agents} onAsk={(text) => openChat(text, false)} />}

          {activeTab === 'nexus' && (
            <NexusView
              agents={agents}
              projects={projectsApi.projects}
              ownerName={profile.name}
              onMakeCards={(projectId, goal) => {
                projectsApi.setActiveId(projectId);
                projectsApi.setPlanRequest({ projectId, goal: `Turn this plan from the team discussion into cards:\n\n${goal}` });
                setActiveTab('projects');
              }}
            />
          )}

          {activeTab === 'chat' && (
            <div className="h-full p-4">
              <ChatView agents={agents} chat={chat} draft={chatDraft} onDraftUsed={() => setChatDraft(null)} />
            </div>
          )}

          {activeTab === 'my-ai' && (
            <MyAIView
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
          )}

          {activeTab === 'pipelines' && (
            <PipelineDAGView pipelines={pipelines} agents={agents} onSavePipeline={handleSavePipeline} onRefreshData={refreshAllData} />
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

          {activeTab === 'settings' && (
            <AccountView
              tab={accountTab}
              setTab={setAccountTab}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onSaved={() => {
                refreshAllData();
                loadProfile();
              }}
            />
          )}
        </main>

        <BottomPanel
          onOpenPreferences={() => openAccount('preferences')}
          project={
            activeTab === 'projects' && projectsApi.active
              ? {
                  project: projectsApi.active,
                  cards: projectsApi.cards.filter((c) => c.projectId === projectsApi.active!.id),
                  agents,
                  onOpenCard: projectsApi.setOpenCardId,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
