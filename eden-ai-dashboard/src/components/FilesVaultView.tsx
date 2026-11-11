import React, { useState } from 'react';
import type { HostedFile } from '../types/index.ts';
import {
  Folder,
  FileCode,
  FileText,
  Search,
  Plus,
  Trash2,
  Copy,
  Check,
  Download,
  GitPullRequest,
  Sparkles,
  ExternalLink,
  Save,
  RefreshCw,
  Eye,
  Edit2,
} from 'lucide-react';

interface FilesVaultViewProps {
  files: HostedFile[];
  onSaveFile: (file: Partial<HostedFile>) => Promise<void>;
  onDeleteFile: (id: string) => Promise<void>;
  onSendFileToSwarm: (file: HostedFile) => void;
}

export const FilesVaultView: React.FC<FilesVaultViewProps> = ({
  files,
  onSaveFile,
  onDeleteFile,
  onSendFileToSwarm,
}) => {
  const [selectedFileId, setSelectedFileId] = useState<string>(files[0]?.id || '');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [copied, setCopied] = useState(false);

  // GitHub Import State
  const [ghRepo, setGhRepo] = useState('');
  const [ghPath, setGhPath] = useState('');
  const [isFetchingGh, setIsFetchingGh] = useState(false);
  const [ghItems, setGhItems] = useState<any[] | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);

  // New File Modal
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('/artifacts/new_spec.md');
  const [newFileCategory, setNewFileCategory] = useState<any>('pipeline_artifact');
  const [newFileContent, setNewFileContent] = useState('# New Technical Specification\n\n');

  const selectedFile = files.find((f) => f.id === selectedFileId) || files[0] || null;

  const handleSelectFile = (file: HostedFile) => {
    setSelectedFileId(file.id);
    setIsEditing(false);
    setEditedContent(file.content);
  };

  const handleCopy = () => {
    if (!selectedFile) return;
    navigator.clipboard.writeText(isEditing ? editedContent : selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!selectedFile) return;
    const blob = new Blob([isEditing ? editedContent : selectedFile.content], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveEdit = async () => {
    if (!selectedFile) return;
    await onSaveFile({
      id: selectedFile.id,
      content: editedContent,
    });
    setIsEditing(false);
  };

  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilePath) return;
    await onSaveFile({
      path: newFilePath,
      name: newFilePath.split('/').pop() || 'file.txt',
      category: newFileCategory,
      content: newFileContent,
      language: newFilePath.endsWith('.ts')
        ? 'typescript'
        : newFilePath.endsWith('.json')
        ? 'json'
        : 'markdown',
    });
    setIsNewModalOpen(false);
  };

  // GitHub fetcher
  const handleFetchGitHub = async (pathOverride?: string) => {
    if (!ghRepo) return;
    setIsFetchingGh(true);
    setGhError(null);
    setGhItems(null);

    try {
      const res = await fetch('/api/github/fetch-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: ghRepo.trim(),
          filePath: (pathOverride ?? ghPath).trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch repository');
      }

      if (data.type === 'dir') {
        setGhItems(data.items);
      } else if (data.type === 'file') {
        setSelectedFileId(data.file.id);
        setGhItems(null);
      }
    } catch (err: any) {
      console.error('GitHub fetch failed:', err);
      setGhError(err.message);
    } finally {
      setIsFetchingGh(false);
    }
  };

  const handleImportGitHubItem = async (item: any) => {
    if (item.type === 'dir') {
      setGhPath(item.path);
      await handleFetchGitHub(item.path);
    } else {
      setIsFetchingGh(true);
      try {
        const res = await fetch('/api/github/fetch-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: ghRepo.trim(),
            filePath: item.path,
          }),
        });
        const data = await res.json();
        if (data.file) {
          setSelectedFileId(data.file.id);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsFetchingGh(false);
      }
    }
  };

  const filteredFiles = files.filter((f) => {
    const matchCat = categoryFilter === 'all' || f.category === categoryFilter;
    const matchSearch =
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.authorAgentName && f.authorAgentName.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCat && matchSearch;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Files
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Saved work from your team, plus files imported from GitHub.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsNewModalOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New file</span>
          </button>
        </div>
      </div>

      {/* GitHub Quick Sync Strip */}
      <div className="p-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
              Import from GitHub
            </h3>
          </div>
          <span className="text-2xs text-slate-400 font-mono"></span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={ghRepo}
            onChange={(e) => setGhRepo(e.target.value)}
            placeholder="Paste a GitHub link, or type owner/name"
            className="flex-1 px-3 py-2 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none"
          />
          <input
            type="text"
            value={ghPath}
            onChange={(e) => setGhPath(e.target.value)}
            placeholder="Folder or file (optional)"
            className="sm:w-64 px-3 py-2 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none"
          />
          <button
            type="button"
            onClick={() => handleFetchGitHub()}
            disabled={isFetchingGh || !ghRepo}
            className="px-4 py-2 text-xs font-semibold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            {isFetchingGh ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Open</span>
          </button>
        </div>

        {ghError && (
          <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-lg border border-red-200 dark:border-red-800">
            {ghError}
          </div>
        )}

        {/* GitHub Directory Listing Explorer */}
        {ghItems && ghItems.length > 0 && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="text-2xs font-semibold text-slate-400 mb-2">
              Showing contents of {ghRepo}/{ghPath || ''}:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
              {ghItems.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleImportGitHubItem(item)}
                  className="p-2 text-left rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-indigo-500 text-xs truncate flex items-center gap-1.5 transition-colors"
                >
                  {item.type === 'dir' ? (
                    <Folder className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  ) : (
                    <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Vault Workspace (Split Tree & Viewer) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[550px]">
        {/* Left Column: File Tree & Filters (4 cols) */}
        <div className="lg:col-span-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search files"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-medium">
              {[
                { id: 'all', label: 'All' },
                { id: 'pipeline_artifact', label: 'Team work' },
                { id: 'github_repo', label: 'GitHub' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    categoryFilter === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* File List */}
            <div className="space-y-1.5 overflow-y-auto max-h-[460px] pr-1">
              {filteredFiles.map((file) => {
                const isSelected = selectedFile?.id === file.id;
                return (
                  <div
                    key={file.id}
                    onClick={() => handleSelectFile(file)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between text-xs ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-950 dark:text-white font-medium'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      {file.category === 'pipeline_artifact' ? (
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      ) : (
                        <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <div className="truncate">
                        <div className="font-mono truncate">{file.name}</div>
                        <div className="text-2xs text-slate-400 truncate">{file.path}</div>
                      </div>
                    </div>

                    <div className="text-2xs font-mono text-slate-400 shrink-0 tabular-nums">
                      {(file.sizeBytes / 1024).toFixed(1)}k
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-2xs font-mono text-slate-400 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span>{files.length} hosted files</span>
            <span>Saved on this PC</span>
          </div>
        </div>

        {/* Right Column: Code Viewer / Editor (8 cols) */}
        <div className="lg:col-span-8 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col justify-between">
          {selectedFile ? (
            <div className="flex flex-col h-full">
              {/* Toolbar */}
              <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                    {selectedFile.path}
                  </span>
                  {selectedFile.authorAgentName && (
                    <span className="text-2xs text-slate-400 font-mono">
                      · Generated by {selectedFile.authorAgentName}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSendFileToSwarm(selectedFile)}
                    className="px-2.5 py-1 text-2xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-md transition-colors flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Ask the team</span>
                  </button>

                  <button
                    onClick={() => {
                      if (!isEditing) setEditedContent(selectedFile.content);
                      setIsEditing(!isEditing);
                    }}
                    className="px-2.5 py-1 text-2xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1"
                  >
                    {isEditing ? <Eye className="w-3 h-3" /> : <Edit2 className="w-3 h-3" />}
                    <span>{isEditing ? 'Preview' : 'Edit'}</span>
                  </button>

                  {isEditing && (
                    <button
                      onClick={handleSaveEdit}
                      className="px-2.5 py-1 text-2xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" />
                      <span>Save</span>
                    </button>
                  )}

                  <button
                    onClick={handleCopy}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
                    title="Copy contents"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={handleDownload}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
                    title="Download file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  {files.length > 1 && (
                    <button
                      onClick={() => onDeleteFile(selectedFile.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded transition-colors"
                      title="Delete file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Editor or Viewer Body */}
              <div className="flex-1 p-4 overflow-y-auto max-h-[500px]">
                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full h-full min-h-[440px] p-4 text-xs font-mono rounded-lg border bg-slate-950 text-slate-200 border-slate-800 focus:outline-none leading-relaxed"
                  />
                ) : (
                  <pre className="text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap selection:bg-indigo-500 selection:text-white">
                    {selectedFile.content}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-24 text-slate-400 text-xs">
              Pick a file to read or edit it.
            </div>
          )}
        </div>
      </div>

      {/* New File Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">New file</h2>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewFile} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Virtual File Path
                </label>
                <input
                  type="text"
                  required
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="/notes/my-note.md"
                  className="w-full px-3 py-2 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Category
                </label>
                <select
                  value={newFileCategory}
                  onChange={(e) => setNewFileCategory(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none"
                >
                  <option value="pipeline_artifact">Team work</option>
                  <option value="github_repo">From GitHub</option>
                  <option value="user_upload">My own file</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Initial File Content
                </label>
                <textarea
                  rows={6}
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition-colors"
                >
                  Create File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
