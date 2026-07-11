'use client';

import { FormEvent, useState } from 'react';
import { Edit3, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RenameProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentName: string;
  onRenameComplete: () => void;
}

export default function RenameProjectModal(props: RenameProjectModalProps) {
  if (!props.isOpen) return null;
  return <RenameProjectDialog key={props.projectId} {...props} />;
}

function RenameProjectDialog({
  isOpen,
  onClose,
  projectId,
  currentName,
  onRenameComplete,
}: RenameProjectModalProps) {
  const [newName, setNewName] = useState(currentName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (isRenaming) return;
    setNewName(currentName);
    setError(null);
    onClose();
  };

  const handleRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === currentName) return;

    setIsRenaming(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!response.ok) throw new Error('Failed to rename project');

      onRenameComplete();
      setNewName(trimmedName);
      onClose();
    } catch (caughtError) {
      console.error('Failed to rename project:', caughtError);
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to rename project');
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent showCloseButton={!isRenaming} className="gap-0 border-white/10 bg-gradient-to-br from-gray-900 to-gray-800 p-0 sm:max-w-md">
        <form onSubmit={handleRename}>
          <DialogHeader className="border-b border-white/10 p-6">
            <div className="flex items-center gap-3">
              <Edit3 className="h-6 w-6 text-theme-primary" />
              <DialogTitle className="text-xl text-white">Rename Project</DialogTitle>
            </div>
            <DialogDescription className="sr-only">Enter a new name for {currentName}.</DialogDescription>
          </DialogHeader>

          <div className="p-6">
            <label htmlFor="project-name" className="mb-2 block text-sm text-gray-400">New Project Name</label>
            <input
              id="project-name"
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              className="input-theme w-full rounded-lg border px-4 py-2 transition-colors focus:outline-none"
              disabled={isRenaming}
            />
            {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          </div>

          <DialogFooter className="border-t border-white/10 p-6">
            <DialogClose asChild>
              <button type="button" disabled={isRenaming} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20 disabled:opacity-50">
                Cancel
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={!newName.trim() || newName.trim() === currentName || isRenaming}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRenaming && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
              {isRenaming ? 'Renaming...' : 'Rename'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
