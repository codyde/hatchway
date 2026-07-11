'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Folder, File, ChevronRight, ChevronDown, FileText, RefreshCw } from 'lucide-react';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
}

interface EditorTabProps {
  projectId?: string | null;
}

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface PendingSave {
  projectId: string;
  path: string;
  content: string;
  revision: number;
}

export default function EditorTab({ projectId }: EditorTabProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const projectIdRef = useRef(projectId);
  const selectedFileRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const activeSaveRef = useRef<PendingSave | null>(null);
  const revisionRef = useRef(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const saveInFlightRef = useRef(false);
  const keepaliveFlushesRef = useRef(new Set<string>());
  const treeControllerRef = useRef<AbortController | null>(null);
  const fileControllerRef = useRef<AbortController | null>(null);
  const fileRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const handleEditorMount: OnMount = (editor, monaco) => {
    // Project dependencies are unavailable to Monaco, but syntax diagnostics
    // remain useful and should not be hidden.
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    });

    monaco.editor.defineTheme('hatchway-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#181225' },
    });
    monaco.editor.setTheme('hatchway-dark');
  };

  const fetchFileTree = useCallback(async (targetProjectId: string) => {
    treeControllerRef.current?.abort();
    const controller = new AbortController();
    treeControllerRef.current = controller;
    setTreeLoading(true);
    setTreeError(null);

    try {
      const res = await fetch(`/api/projects/${targetProjectId}/files`, {
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Unable to load files (${res.status})`);
      }
      if (projectIdRef.current !== targetProjectId || controller.signal.aborted) return;
      setFiles(Array.isArray(data?.files) ? data.files : []);
    } catch (error) {
      if (controller.signal.aborted || projectIdRef.current !== targetProjectId) return;
      console.error('Failed to fetch file tree:', error);
      setTreeError(error instanceof Error ? error.message : 'Unable to load files');
      setFiles([]);
    } finally {
      if (projectIdRef.current === targetProjectId && !controller.signal.aborted) {
        setTreeLoading(false);
      }
    }
  }, []);

  async function performSave(save: PendingSave) {
    if (save.projectId !== projectIdRef.current) return;
    if (saveInFlightRef.current) {
      pendingSaveRef.current = save;
      return;
    }

    saveInFlightRef.current = true;
    activeSaveRef.current = save;
    if (pendingSaveRef.current?.revision === save.revision) {
      pendingSaveRef.current = null;
    }
    const controller = new AbortController();
    saveControllerRef.current = controller;
    const isCurrentFile = () => (
      mountedRef.current &&
      projectIdRef.current === save.projectId &&
      selectedFileRef.current === save.path
    );
    if (isCurrentFile()) {
      setSaveStatus('saving');
      setSaveError(null);
    }

    let succeeded = false;
    try {
      const res = await fetch(`/api/projects/${save.projectId}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: save.path, content: save.content }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Unable to save file (${res.status})`);
      }
      succeeded = true;
      if (isCurrentFile()) {
        setSaveStatus(pendingSaveRef.current ? 'dirty' : 'saved');
      }
    } catch (error) {
      if (controller.signal.aborted || projectIdRef.current !== save.projectId) return;
      console.error('Failed to save file:', error);
      if (!pendingSaveRef.current) pendingSaveRef.current = save;
      if (isCurrentFile()) {
        setSaveStatus('error');
        setSaveError(error instanceof Error ? error.message : 'Unable to save file');
      }
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = null;
      if (activeSaveRef.current?.revision === save.revision) activeSaveRef.current = null;
      saveInFlightRef.current = false;
      const next = pendingSaveRef.current;
      if (
        next &&
        next.projectId === projectIdRef.current &&
        (succeeded || next.revision !== save.revision)
      ) {
        void performSave(next);
      }
    }
  }

  function flushPendingSave() {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (pending && pending.projectId === projectIdRef.current) {
      void performSave(pending);
    }
  }

  function persistLatestEdit(targetProjectId: string | null | undefined) {
    if (!targetProjectId) return;

    const candidates = [pendingSaveRef.current, activeSaveRef.current].filter(
      (save): save is PendingSave => save?.projectId === targetProjectId
    );
    if (candidates.length === 0) return;

    const latestByPath = new Map<string, PendingSave>();
    for (const save of candidates) {
      const current = latestByPath.get(save.path);
      if (!current || save.revision > current.revision) latestByPath.set(save.path, save);
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (activeSaveRef.current?.projectId === targetProjectId) {
      saveControllerRef.current?.abort();
      activeSaveRef.current = null;
    }
    if (pendingSaveRef.current?.projectId === targetProjectId) {
      pendingSaveRef.current = null;
    }

    for (const latest of latestByPath.values()) {
      const flushKey = `${latest.projectId}:${latest.path}:${latest.revision}`;
      if (keepaliveFlushesRef.current.has(flushKey)) continue;
      keepaliveFlushesRef.current.add(flushKey);

      void fetch(`/api/projects/${latest.projectId}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: latest.path, content: latest.content }),
        keepalive: true,
      }).then((response) => {
        if (!response.ok) {
          console.error(`Failed to persist ${latest.path} before leaving project ${latest.projectId}`);
        }
      }).catch((error) => console.error('Failed to persist file before navigation:', error));
    }
  }

  useEffect(() => {
    projectIdRef.current = projectId;
    treeControllerRef.current?.abort();
    fileControllerRef.current?.abort();
    saveControllerRef.current?.abort();
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    pendingSaveRef.current = null;
    activeSaveRef.current = null;
    selectedFileRef.current = null;
    fileRequestRef.current += 1;

    /* eslint-disable react-hooks/set-state-in-effect -- Reset project-scoped editor state before loading the next project. */
    setFiles([]);
    setTreeError(null);
    setSelectedFile(null);
    setFileContent('');
    setFileLoading(false);
    setFileError(null);
    setSaveStatus('idle');
    setSaveError(null);
    setCollapsedFolders(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */

    if (projectId) void fetchFileTree(projectId);
    else setTreeLoading(false);

    return () => {
      treeControllerRef.current?.abort();
      fileControllerRef.current?.abort();
      persistLatestEdit(projectId);
    };
  }, [projectId, fetchFileTree]);

  useEffect(() => {
    mountedRef.current = true;
    const flushForNavigation = () => {
      persistLatestEdit(projectIdRef.current);
    };

    window.addEventListener('pagehide', flushForNavigation);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', flushForNavigation);
      flushForNavigation();
    };
  }, []);

  const fetchFileContent = async (path: string) => {
    const targetProjectId = projectIdRef.current;
    if (!targetProjectId) return;

    flushPendingSave();
    fileControllerRef.current?.abort();
    const controller = new AbortController();
    fileControllerRef.current = controller;
    const requestId = ++fileRequestRef.current;
    selectedFileRef.current = path;
    setSelectedFile(path);
    setFileContent('');
    setFileLoading(true);
    setFileError(null);
    setSaveStatus('idle');
    setSaveError(null);

    try {
      const res = await fetch(
        `/api/projects/${targetProjectId}/files/content?path=${encodeURIComponent(path)}`,
        { signal: controller.signal }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Unable to load file (${res.status})`);
      }
      if (
        controller.signal.aborted ||
        projectIdRef.current !== targetProjectId ||
        selectedFileRef.current !== path ||
        fileRequestRef.current !== requestId
      ) return;
      setFileContent(data?.content || '');
    } catch (error) {
      if (controller.signal.aborted || projectIdRef.current !== targetProjectId) return;
      console.error('Failed to fetch file content:', error);
      setFileError(error instanceof Error ? error.message : 'Unable to load file');
    } finally {
      if (
        projectIdRef.current === targetProjectId &&
        selectedFileRef.current === path &&
        fileRequestRef.current === requestId
      ) {
        setFileLoading(false);
      }
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const targetProjectId = projectIdRef.current;
    const path = selectedFileRef.current;
    if (value === undefined || !targetProjectId || !path || fileLoading) return;

    setFileContent(value);
    const pending: PendingSave = {
      projectId: targetProjectId,
      path,
      content: value,
      revision: ++revisionRef.current,
    };
    pendingSaveRef.current = pending;
    setSaveStatus('dirty');
    setSaveError(null);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      if (pending.projectId === projectIdRef.current) void performSave(pending);
    }, 2000);
  };

  const retrySave = () => {
    const pending = pendingSaveRef.current;
    if (pending && pending.projectId === projectIdRef.current) void performSave(pending);
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
      json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown',
      py: 'python', rs: 'rust', go: 'go', sql: 'sql', yaml: 'yaml', yml: 'yaml',
      toml: 'toml', xml: 'xml',
    };
    return langMap[ext || ''] || 'plaintext';
  };

  const renderFileTree = (nodes: FileNode[], depth = 0) => nodes.map((node) => {
    const isCollapsed = collapsedFolders.has(node.path);
    return (
      <div key={node.path}>
        {node.type === 'directory' ? (
          <>
            <button
              onClick={() => toggleFolder(node.path)}
              className="w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-white/5 transition-colors text-left"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {isCollapsed
                ? <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" />
                : <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />}
              <Folder className="w-4 h-4 shrink-0 text-blue-400" />
              <span className="truncate text-gray-300">{node.name}</span>
            </button>
            {!isCollapsed && node.children && renderFileTree(node.children, depth + 1)}
          </>
        ) : (
          <button
            onClick={() => fetchFileContent(node.path)}
            className={`w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-white/5 transition-colors text-left ${
              selectedFile === node.path ? 'bg-theme-primary-muted' : ''
            }`}
            style={{ paddingLeft: `${depth * 12 + 28}px` }}
          >
            <File className="w-4 h-4 shrink-0 text-gray-400" />
            <span className="truncate text-gray-300">{node.name}</span>
          </button>
        )}
      </div>
    );
  });

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <p>Select a project to edit files</p>
      </div>
    );
  }

  const saveLabel: Record<SaveStatus, string> = {
    idle: '', dirty: 'Unsaved', saving: 'Saving...', saved: 'Saved', error: 'Save failed',
  };

  return (
    <div className="h-full min-h-0 flex flex-col sm:flex-row">
      <div className="w-full max-h-48 shrink-0 border-b border-white/10 overflow-y-auto bg-black/20 sm:w-64 sm:max-h-none sm:border-b-0 sm:border-r">
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-300">Files</h3>
          {treeError && (
            <button
              onClick={() => fetchFileTree(projectId)}
              className="text-gray-400 hover:text-white"
              title="Retry loading files"
              aria-label="Retry loading files"
              type="button"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="py-2">
          {treeLoading ? (
            <div className="p-4 text-sm text-gray-500">Loading files...</div>
          ) : treeError ? (
            <div className="p-4 text-sm text-red-300" role="alert">{treeError}</div>
          ) : files.length > 0 ? (
            renderFileTree(files)
          ) : (
            <div className="p-4 text-sm text-gray-500">No files found</div>
          )}
        </div>
      </div>

      <div className="min-w-0 min-h-0 flex-1 flex flex-col bg-[#181225]">
        {selectedFile ? (
          <>
            <div className="px-3 py-2 border-b border-white/10 flex flex-wrap items-center gap-2 bg-black/20 sm:px-4">
              <FileText className="w-4 h-4 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-sm font-mono text-gray-300" title={selectedFile}>
                {selectedFile}
              </span>
              <span
                className={`max-w-64 truncate text-xs ${
                  saveStatus === 'error' ? 'text-red-300' :
                  saveStatus === 'saved' ? 'text-green-300' :
                  saveStatus === 'idle' ? 'text-gray-500' : 'text-yellow-300'
                }`}
                role={saveStatus === 'error' ? 'alert' : 'status'}
                aria-live={saveStatus === 'error' ? 'assertive' : 'polite'}
                aria-atomic="true"
                title={saveStatus === 'error' ? saveError || 'Save failed' : undefined}
              >
                {fileLoading
                  ? 'Loading...'
                  : saveStatus === 'error' && saveError
                  ? `Save failed: ${saveError}`
                  : saveLabel[saveStatus]}
              </span>
              {saveStatus === 'error' && (
                <button
                  onClick={retrySave}
                  className="rounded bg-red-500/15 px-2 py-1 text-xs text-red-200 hover:bg-red-500/25"
                  title={saveError || 'Retry save'}
                  type="button"
                >
                  Retry
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1">
              {fileLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading file...</div>
              ) : fileError ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-sm text-red-300" role="alert">{fileError}</p>
                  <button
                    onClick={() => fetchFileContent(selectedFile)}
                    className="rounded bg-white/10 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/15"
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <Editor
                  height="100%"
                  path={`${projectId}/${selectedFile}`}
                  language={getLanguage(selectedFile)}
                  value={fileContent}
                  onChange={handleEditorChange}
                  onMount={handleEditorMount}
                  theme="hatchway-dark"
                  options={{
                    fontSize: 14,
                    fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: 'on',
                  }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            <p>Select a file to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}
