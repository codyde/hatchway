'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Key,
  Trash2,
  RefreshCw,
  Loader2,
  Plus,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  Lock,
  User,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useRailwayVariables,
  useUpdateRailwayVariables,
  useRailwayDomains,
  useRegenerateRailwayDomain,
  useUpdateRailwayDomain,
  useDeleteRailwayService,
  useRedeployRailwayService,
  useProjectRailwayStatus,
} from '@/queries/railway';
import { RailwayLogo } from './RailwayLogo';

interface RailwaySettingsModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'variables' | 'domain' | 'danger';

// Known system variable prefixes that Railway sets automatically
const SYSTEM_VAR_PREFIXES = [
  'RAILWAY_',
  'PORT',
  'NIXPACKS_',
  'CI',
  'NODE_ENV',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'DATABASE_URL',
  'DATABASE_PRIVATE_URL',
  'DATABASE_PUBLIC_URL',
  'REDIS_URL',
  'REDIS_PRIVATE_URL',
  'REDIS_PUBLIC_URL',
];

function isSystemVariable(key: string): boolean {
  return SYSTEM_VAR_PREFIXES.some(prefix => 
    key === prefix || key.startsWith(prefix + '_') || key.startsWith(prefix)
  );
}

export function RailwaySettingsModal({
  projectId,
  isOpen,
  onClose,
}: RailwaySettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('variables');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="bg-gray-900 border-gray-700 w-full max-w-2xl h-[600px] flex flex-col p-0 gap-0"
        showCloseButton={true}
      >
        {/* Fixed Header */}
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600/20 rounded-lg">
              <RailwayLogo width={20} height={20} />
            </div>
            <DialogTitle className="text-white">Railway Settings</DialogTitle>
          </div>
        </DialogHeader>

        {/* Fixed Tabs */}
        <div className="flex-shrink-0 flex gap-1 px-6 py-3 border-b border-gray-800 bg-gray-900">
          <TabButton
            active={activeTab === 'variables'}
            onClick={() => setActiveTab('variables')}
            icon={<Key className="w-4 h-4" />}
            label="Variables"
          />
          <TabButton
            active={activeTab === 'domain'}
            onClick={() => setActiveTab('domain')}
            icon={<Globe className="w-4 h-4" />}
            label="Domain"
          />
          <TabButton
            active={activeTab === 'danger'}
            onClick={() => setActiveTab('danger')}
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Danger Zone"
            danger
          />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === 'variables' && <VariablesTab projectId={projectId} />}
          {activeTab === 'domain' && <DomainTab projectId={projectId} />}
          {activeTab === 'danger' && <DangerZoneTab projectId={projectId} onClose={onClose} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Tab Button Component
function TabButton({
  active,
  onClick,
  icon,
  label,
  danger = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
        active
          ? danger
            ? 'bg-red-600/20 text-red-400'
            : 'bg-purple-600/20 text-purple-400'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ============================================
// Variables Tab
// ============================================

interface EnvVariable {
  key: string;
  value: string;
}

type VarSubTab = 'user' | 'system';

function VariablesTab({ projectId }: { projectId: string }) {
  const { data, isLoading, refetch } = useRailwayVariables(projectId);
  const updateMutation = useUpdateRailwayVariables(projectId);

  const [userVariables, setUserVariables] = useState<EnvVariable[]>([]);
  const [systemVariables, setSystemVariables] = useState<EnvVariable[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<VarSubTab>('user');
  const [originalUserKeys, setOriginalUserKeys] = useState<Set<string>>(new Set());

  // Initialize variables from fetched data - separate user and system
  useEffect(() => {
    if (data?.variables) {
      const userVars: EnvVariable[] = [];
      const sysVars: EnvVariable[] = [];
      
      Object.entries(data.variables).forEach(([key, value]) => {
        if (isSystemVariable(key)) {
          sysVars.push({ key, value });
        } else {
          userVars.push({ key, value });
        }
      });
      
      setUserVariables(userVars);
      setSystemVariables(sysVars);
      setOriginalUserKeys(new Set(userVars.map(v => v.key)));
      setHasChanges(false);
    }
  }, [data]);

  // Handle paste in key or value field - parse .env format
  const handlePaste = useCallback((e: React.ClipboardEvent, field: 'key' | 'value') => {
    const text = e.clipboardData.getData('text');
    
    const lines = text.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    const envPairs = lines
      .map(line => {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
        if (match) {
          let value = match[2];
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return { key: match[1], value };
        }
        return null;
      })
      .filter((pair): pair is EnvVariable => pair !== null);

    if (envPairs.length > 1) {
      e.preventDefault();
      const existingKeys = new Set(userVariables.map(v => v.key));
      const newVars = envPairs.filter(pair => !existingKeys.has(pair.key) && !isSystemVariable(pair.key));
      
      if (newVars.length > 0) {
        setUserVariables(prev => [...prev, ...newVars]);
        setHasChanges(true);
      }
    } else if (envPairs.length === 1 && field === 'key') {
      e.preventDefault();
      setNewKey(envPairs[0].key);
      setNewValue(envPairs[0].value);
    }
  }, [userVariables]);

  const handleAddVariable = () => {
    if (!newKey.trim()) return;
    
    const key = newKey.trim();
    if (userVariables.some(v => v.key === key)) {
      setUserVariables(prev =>
        prev.map(v => (v.key === key ? { ...v, value: newValue } : v))
      );
    } else {
      setUserVariables(prev => [...prev, { key, value: newValue }]);
    }
    
    setNewKey('');
    setNewValue('');
    setHasChanges(true);
  };

  const handleUpdateVariable = (index: number, field: 'key' | 'value', value: string) => {
    setUserVariables(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setHasChanges(true);
  };

  const handleDeleteVariable = (index: number) => {
    setUserVariables(prev => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Combine user variables with system variables for the update
    const allVars: Record<string, string> = {};
    
    // Add system vars back (unchanged)
    systemVariables.forEach(({ key, value }) => {
      allVars[key] = value;
    });
    
    // Add user vars
    userVariables.forEach(({ key, value }) => {
      if (key.trim()) {
        allVars[key.trim()] = value;
      }
    });

    await updateMutation.mutateAsync(allVars);
    setOriginalUserKeys(new Set(userVariables.map(v => v.key)));
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Sub-tabs for User/System */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 p-1 bg-gray-800 rounded-lg">
          <button
            onClick={() => setActiveSubTab('user')}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
              activeSubTab === 'user'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            )}
          >
            <User className="w-3.5 h-3.5" />
            User Variables
            {userVariables.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-purple-600/30 text-purple-400 rounded">
                {userVariables.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('system')}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
              activeSubTab === 'system'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            )}
          >
            <Lock className="w-3.5 h-3.5" />
            System Variables
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-600/50 text-gray-400 rounded">
              {systemVariables.length}
            </span>
          </button>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {activeSubTab === 'user' ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Add your own environment variables. Changes trigger a new deployment.
          </p>

          {/* User Variables List */}
          {userVariables.length > 0 ? (
            <div className="space-y-2">
              {userVariables.map((variable, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={variable.key}
                    onChange={(e) => handleUpdateVariable(index, 'key', e.target.value)}
                    placeholder="KEY"
                    className="flex-1 px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                  />
                  <input
                    type="text"
                    value={variable.value}
                    onChange={(e) => handleUpdateVariable(index, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-[2] px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                  />
                  <button
                    onClick={() => handleDeleteVariable(index)}
                    className="p-2 text-gray-400 hover:text-red-400 rounded-md hover:bg-gray-800 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-500 text-sm border border-dashed border-gray-700 rounded-lg">
              No user variables yet. Add your first variable below.
            </div>
          )}

          {/* Add New Variable */}
          <div className="flex gap-2 pt-4 border-t border-gray-700">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              onPaste={(e) => handlePaste(e, 'key')}
              onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
              placeholder="NEW_KEY (paste .env here)"
              className="flex-1 px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onPaste={(e) => handlePaste(e, 'value')}
              onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
              placeholder="value"
              className="flex-[2] px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
            />
            <button
              onClick={handleAddVariable}
              disabled={!newKey.trim()}
              className={cn(
                'p-2 rounded-md transition-colors',
                newKey.trim()
                  ? 'text-purple-400 hover:bg-purple-600/20'
                  : 'text-gray-600 cursor-not-allowed'
              )}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Save Button */}
          {hasChanges && (
            <div className="flex justify-end pt-4 border-t border-gray-700">
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
                  'bg-purple-600 hover:bg-purple-500 text-white',
                  updateMutation.isPending && 'opacity-50 cursor-not-allowed'
                )}
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save Changes
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            These variables are set automatically by Railway. They typically don't need to be changed.
          </p>

          {/* System Variables List (read-only display) */}
          <div className="space-y-2">
            {systemVariables.map((variable, index) => (
              <div key={index} className="flex gap-2 opacity-75">
                <div className="flex-1 px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-md text-gray-400 font-mono truncate">
                  {variable.key}
                </div>
                <div className="flex-[2] px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-md text-gray-500 font-mono truncate">
                  {variable.value.length > 50 ? variable.value.slice(0, 50) + '...' : variable.value}
                </div>
              </div>
            ))}
          </div>

          {systemVariables.length === 0 && (
            <div className="py-8 text-center text-gray-500 text-sm">
              No system variables detected.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Domain Tab
// ============================================

function DomainTab({ projectId }: { projectId: string }) {
  const { data: statusData, refetch: refetchStatus } = useProjectRailwayStatus(projectId);
  const { data: domainsData, isLoading } = useRailwayDomains(projectId);
  const regenerateMutation = useRegenerateRailwayDomain(projectId);
  const updateDomainMutation = useUpdateRailwayDomain(projectId);
  
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [subdomain, setSubdomain] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);

  const currentDomain = statusData?.domain || domainsData?.domains?.serviceDomains?.[0]?.domain;
  const currentUrl = currentDomain ? `https://${currentDomain}` : null;
  
  // Parse the subdomain from current domain (e.g., "myapp-production.up.railway.app" -> "myapp-production")
  const domainSuffix = '.up.railway.app';
  const currentSubdomain = currentDomain?.endsWith(domainSuffix) 
    ? currentDomain.slice(0, -domainSuffix.length) 
    : '';

  // Initialize subdomain when domain loads
  useEffect(() => {
    if (currentSubdomain && !isEditing) {
      setSubdomain(currentSubdomain);
    }
  }, [currentSubdomain, isEditing]);

  const handleCopy = async () => {
    if (currentUrl) {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStartEdit = () => {
    setSubdomain(currentSubdomain);
    setIsEditing(true);
    setUpdateError(null);
  };

  const handleCancelEdit = () => {
    setSubdomain(currentSubdomain);
    setIsEditing(false);
    setUpdateError(null);
  };

  const handleUpdateDomain = async () => {
    if (!subdomain.trim()) {
      setUpdateError('Subdomain cannot be empty');
      return;
    }

    // Validate subdomain format
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(subdomain.toLowerCase())) {
      setUpdateError('Subdomain can only contain lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.');
      return;
    }

    setUpdateError(null);

    try {
      await updateDomainMutation.mutateAsync(subdomain);
      setIsEditing(false);
      refetchStatus();
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Failed to update domain');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Current Domain */}
      <div>
        <h3 className="text-sm font-medium text-white mb-2">Railway Domain</h3>
        <p className="text-sm text-gray-400 mb-4">
          Your service is accessible at this URL. Click the edit button to change the subdomain.
        </p>

        {currentDomain ? (
          <div className="space-y-3">
            {isEditing ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1 p-3 bg-gray-800 rounded-lg border border-gray-700">
                  <span className="text-gray-500 text-sm">https://</span>
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                    className="flex-1 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="your-subdomain"
                  />
                  <span className="text-gray-500 text-sm">{domainSuffix}</span>
                </div>
                
                {updateError && (
                  <p className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded-md">
                    {updateError}
                  </p>
                )}
                
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelEdit}
                    disabled={updateDomainMutation.isPending}
                    className="px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateDomain}
                    disabled={updateDomainMutation.isPending || subdomain === currentSubdomain}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                      'bg-purple-600 hover:bg-purple-500 text-white',
                      (updateDomainMutation.isPending || subdomain === currentSubdomain) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {updateDomainMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-gray-800 rounded-lg border border-gray-700">
                <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <code className="flex-1 text-sm text-purple-400 font-mono truncate">
                  {currentUrl}
                </code>
                <button
                  onClick={handleStartEdit}
                  className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors"
                  title="Edit subdomain"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCopy}
                  className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors"
                  title="Copy URL"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <a
                  href={currentUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 bg-gray-800 rounded-lg border border-gray-700 text-gray-400 text-sm">
            No domain configured
          </div>
        )}
      </div>

      {/* Regenerate Domain */}
      <div className="pt-4 border-t border-gray-700">
        <h3 className="text-sm font-medium text-white mb-2">Regenerate Domain</h3>
        <p className="text-sm text-gray-400 mb-4">
          Generate a new random subdomain. Your old domain will stop working immediately.
        </p>
        <button
          onClick={async () => {
            await regenerateMutation.mutateAsync();
            refetchStatus();
          }}
          disabled={regenerateMutation.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
            'bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300',
            regenerateMutation.isPending && 'opacity-50 cursor-not-allowed'
          )}
        >
          {regenerateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Regenerate Domain
        </button>
      </div>

      {/* Custom domain note */}
      <div className="pt-4 border-t border-gray-700">
        <h3 className="text-sm font-medium text-white mb-2">Custom Domain</h3>
        <p className="text-sm text-gray-400 mb-3">
          Need to use your own domain like <code className="px-1 py-0.5 bg-gray-800 rounded text-purple-400">app.yourdomain.com</code>?
        </p>
        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-400">
            To add a custom domain, visit your project in the{' '}
            <a
              href="https://railway.app/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300"
            >
              Railway Dashboard
            </a>
            {' '}and configure DNS settings.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Danger Zone Tab
// ============================================

function DangerZoneTab({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleteType, setDeleteType] = useState<'service' | 'project' | null>(null);
  
  const deleteMutation = useDeleteRailwayService(projectId);
  const redeployMutation = useRedeployRailwayService(projectId);

  const handleDelete = async (deleteProject: boolean) => {
    await deleteMutation.mutateAsync(deleteProject);
    onClose();
  };

  const handleRedeploy = async () => {
    await redeployMutation.mutateAsync();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Redeploy */}
      <div>
        <h3 className="text-sm font-medium text-white mb-2">Redeploy Service</h3>
        <p className="text-sm text-gray-400 mb-4">
          Trigger a new deployment using the latest code from your connected repository.
        </p>
        <button
          onClick={handleRedeploy}
          disabled={redeployMutation.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
            'bg-purple-600 hover:bg-purple-500 text-white',
            redeployMutation.isPending && 'opacity-50 cursor-not-allowed'
          )}
        >
          {redeployMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Redeploy
        </button>
      </div>

      {/* Delete Service */}
      <div className="pt-4 border-t border-gray-700">
        <h3 className="text-sm font-medium text-red-400 mb-2">Delete Service</h3>
        <p className="text-sm text-gray-400 mb-4">
          Remove the service from Railway. The Railway project will be kept and can be reconnected later.
        </p>
        
        {deleteType === 'service' ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              Type <code className="px-1 py-0.5 bg-gray-800 rounded text-red-400">delete service</code> to confirm:
            </p>
            <input
              type="text"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="delete service"
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDeleteType(null);
                  setConfirmDelete('');
                }}
                className="px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(false)}
                disabled={confirmDelete !== 'delete service' || deleteMutation.isPending}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
                  'bg-red-600 hover:bg-red-500 text-white',
                  (confirmDelete !== 'delete service' || deleteMutation.isPending) && 'opacity-50 cursor-not-allowed'
                )}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete Service
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDeleteType('service')}
            className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 rounded-md transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Service
          </button>
        )}
      </div>

      {/* Delete Project */}
      <div className="pt-4 border-t border-gray-700">
        <h3 className="text-sm font-medium text-red-400 mb-2">Delete Railway Project</h3>
        <p className="text-sm text-gray-400 mb-4">
          <strong>Permanently</strong> delete the entire Railway project including all services, 
          deployments, and data. This action cannot be undone.
        </p>
        
        {deleteType === 'project' ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              Type <code className="px-1 py-0.5 bg-gray-800 rounded text-red-400">delete project</code> to confirm:
            </p>
            <input
              type="text"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="delete project"
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDeleteType(null);
                  setConfirmDelete('');
                }}
                className="px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(true)}
                disabled={confirmDelete !== 'delete project' || deleteMutation.isPending}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
                  'bg-red-600 hover:bg-red-500 text-white',
                  (confirmDelete !== 'delete project' || deleteMutation.isPending) && 'opacity-50 cursor-not-allowed'
                )}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete Project
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDeleteType('project')}
            className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 rounded-md transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Railway Project
          </button>
        )}
      </div>
    </div>
  );
}
