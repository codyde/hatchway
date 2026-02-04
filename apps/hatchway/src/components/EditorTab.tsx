'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Folder, File, ChevronRight, ChevronDown, FileText } from 'lucide-react';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
}

interface EditorTabProps {
  projectId?: string | null;
}

export default function EditorTab({ projectId }: EditorTabProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    // Disable ALL TypeScript/JavaScript validation and diagnostics
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    });

    // Define custom theme with purple background
    monaco.editor.defineTheme('sentry-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#181225',
      },
    });
    monaco.editor.setTheme('sentry-dark');
  };

  const fetchFileTree = useCallback(async () => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch (error) {
      console.error('Failed to fetch file tree:', error);
    }
  }, [projectId]);

  // Fetch file tree
  useEffect(() => {
    if (projectId) {
      fetchFileTree();
    }
  }, [projectId, fetchFileTree]);

  const fetchFileContent = async (path: string) => {
    if (!projectId) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`);
      const data = await res.json();

      if (res.ok) {
        setFileContent(data.content || '');
        setSelectedFile(path);
      } else {
        console.error('Failed to load file:', data.error);
        setFileContent(`// Error: ${data.error}\n// ${data.message || ''}`);
      }
    } catch (error) {
      console.error('Failed to fetch file content:', error);
      setFileContent('// Error loading file');
    } finally {
      setIsLoading(false);
    }
  };

  const saveFileContent = useCallback(async (path: string, content: string) => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });

      if (!res.ok) {
        console.error('Failed to save file');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [projectId]);

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !selectedFile) return;

    setFileContent(value);

    // Debounced auto-save (2 seconds)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveFileContent(selectedFile, value);
    }, 2000);
  };

  const toggleFolder = (path: string) => {
    const newCollapsed = new Set(collapsedFolders);
    if (newCollapsed.has(path)) {
      newCollapsed.delete(path);
    } else {
      newCollapsed.add(path);
    }
    setCollapsedFolders(newCollapsed);
  };

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      json: 'json',
      css: 'css',
      scss: 'scss',
      html: 'html',
      md: 'markdown',
      py: 'python',
      rs: 'rust',
      go: 'go',
      sql: 'sql',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      xml: 'xml',
    };
    return langMap[ext || ''] || 'plaintext';
  };

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => {
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
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
                <Folder className="w-4 h-4 text-blue-400" />
                <span className="text-gray-300">{node.name}</span>
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
              <File className="w-4 h-4 text-gray-400" />
              <span className="text-gray-300">{node.name}</span>
            </button>
          )}
        </div>
      );
    });
  };

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <p>Select a project to edit files</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* File Tree Sidebar */}
      <div className="w-64 border-r border-white/10 overflow-y-auto bg-black/20">
        <div className="p-3 border-b border-white/10">
          <h3 className="text-sm font-medium text-gray-300">Files</h3>
        </div>
        <div className="py-2">
          {files.length > 0 ? (
            renderFileTree(files)
          ) : (
            <div className="p-4 text-sm text-gray-500">No files found</div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col bg-[#181225]">
        {selectedFile ? (
          <>
            {/* File Path Header */}
            <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2 bg-black/20">
              <FileText className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-mono text-gray-300">{selectedFile}</span>
              {isLoading && (
                <span className="text-xs text-yellow-400 animate-pulse">Loading...</span>
              )}
            </div>

            {/* Monaco Editor */}
            <div className="flex-1">
              <Editor
                height="100%"
                path={selectedFile}
                value={fileContent}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme="sentry-dark"
                defaultLanguage="typescript"
                options={{
                  fontSize: 14,
                  fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                }}
                loading={
                  <div className="h-full flex items-center justify-center text-gray-400">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                }
              />
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
