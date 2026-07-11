'use client';

import { useState } from 'react';
import { AlertTriangle, FolderOpen, Loader2, Trash2 } from 'lucide-react';
import { useDeleteProject } from '@/mutations/projects';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DeleteProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectPath?: string | null;
  onDeleteComplete: (message: string) => void;
}

export default function DeleteProjectModal(props: DeleteProjectModalProps) {
  if (!props.isOpen) return null;
  return <DeleteProjectDialog key={props.projectId} {...props} />;
}

function DeleteProjectDialog({
  isOpen,
  onClose,
  projectId,
  projectName,
  projectSlug,
  projectPath,
  onDeleteComplete,
}: DeleteProjectModalProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useDeleteProject();

  const handleClose = () => {
    if (deleteMutation.isPending) return;
    setDeleteFiles(false);
    setError(null);
    onClose();
  };

  const handleDelete = async () => {
    setError(null);

    try {
      const result = await deleteMutation.mutateAsync({
        projectId,
        options: { deleteFiles },
      });

      let message: string;
      if (result.filesDeleted) {
        message = `"${projectName}" and its files have been deleted`;
      } else if (result.filesRequested) {
        message = `"${projectName}" removed (files kept - no runner connected)`;
      } else {
        message = `"${projectName}" removed (files kept on disk)`;
      }

      onDeleteComplete(message);
      setDeleteFiles(false);
      onClose();
    } catch (caughtError) {
      console.error('Failed to delete project:', caughtError);
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to delete project');
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <AlertDialogContent className="overflow-hidden border-white/10 bg-gradient-to-br from-gray-900 to-gray-800 p-0 sm:max-w-md">
        <AlertDialogHeader className="border-b border-white/10 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <AlertDialogTitle className="text-white">Delete &quot;{projectName}&quot;?</AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-xs text-gray-400">
                Removing this project cannot be undone. Project files are kept by default.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <fieldset className="space-y-3 p-5">
          <legend className="sr-only">Choose whether to keep project files</legend>
          <div className={`flex items-start gap-3 rounded-lg border-2 p-3 transition-all ${
            !deleteFiles
              ? 'border-theme-primary/50 bg-theme-primary-muted'
              : 'border-transparent bg-white/5 hover:bg-white/10'
          }`}>
            <input
              type="radio"
              id="keep-project-files"
              name="deleteOption"
              checked={!deleteFiles}
              onChange={() => setDeleteFiles(false)}
              className="mt-0.5"
            />
            <label htmlFor="keep-project-files" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-theme-primary" />
                <span className="text-sm font-medium text-white">Keep project files</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Remove from Hatchway but keep files at:<br />
                <code className="break-all text-gray-500">{projectPath || `~/hatchway-workspace/${projectSlug}`}</code>
              </p>
            </label>
          </div>

          <div className={`flex items-start gap-3 rounded-lg border-2 p-3 transition-all ${
            deleteFiles
              ? 'border-red-500/50 bg-red-500/20'
              : 'border-transparent bg-white/5 hover:bg-white/10'
          }`}>
            <input
              type="radio"
              id="delete-project-files"
              name="deleteOption"
              checked={deleteFiles}
              onChange={() => setDeleteFiles(true)}
              className="mt-0.5"
            />
            <label htmlFor="delete-project-files" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-400" />
                <span className="text-sm font-medium text-white">Delete everything</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">Permanently delete the project and all files from disk.</p>
            </label>
          </div>

          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </fieldset>

        <AlertDialogFooter className="border-t border-white/10 bg-black/20 p-5">
          <AlertDialogCancel disabled={deleteMutation.isPending} className="border-0 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            disabled={deleteMutation.isPending}
            className={deleteFiles ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-orange-600 text-white hover:bg-orange-700'}
          >
            {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {deleteMutation.isPending ? 'Deleting...' : deleteFiles ? 'Delete Everything' : 'Remove from Hatchway'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
