'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Trash2, AlertTriangle, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDeleteProject } from '@/mutations/projects';

interface DeleteProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectSlug: string;
  onDeleteComplete: (message: string) => void;
}

const HOLD_DURATION = 1500; // 1.5 seconds to confirm

export default function DeleteProjectModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  projectSlug,
  onDeleteComplete,
}: DeleteProjectModalProps) {
  // Default to keeping files (safer default)
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdStartRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const deleteMutation = useDeleteProject();

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDeleteFiles(false);
      setHoldProgress(0);
      setIsHolding(false);
      holdStartRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  }, [isOpen]);

  // Ref to hold the latest handleDelete function - fixes stale closure in updateProgress
  const handleDeleteRef = useRef<() => Promise<void>>();

  const handleDelete = async () => {
    try {
      const result = await deleteMutation.mutateAsync({
        projectId,
        options: { deleteFiles },
      });

      // Create success message based on actual result
      let message: string;
      if (result.filesDeleted) {
        message = `"${projectName}" and its files have been deleted`;
      } else if (result.filesRequested && !result.filesDeleted) {
        message = `"${projectName}" removed (files kept - no runner connected)`;
      } else {
        message = `"${projectName}" removed (files kept on disk)`;
      }

      onDeleteComplete(message);
      onClose();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  // Keep ref updated with latest handleDelete (which captures current deleteFiles state)
  handleDeleteRef.current = handleDelete;

  const updateProgress = useCallback(() => {
    if (!holdStartRef.current) return;

    const elapsed = Date.now() - holdStartRef.current;
    const progress = Math.min(elapsed / HOLD_DURATION, 1);
    setHoldProgress(progress);

    if (progress < 1) {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    } else {
      // Trigger delete - use ref to get latest handleDelete with current deleteFiles state
      handleDeleteRef.current?.();
    }
  }, []);

  const handleMouseDown = () => {
    if (deleteMutation.isPending) return;
    setIsHolding(true);
    holdStartRef.current = Date.now();
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  };

  const handleMouseUp = () => {
    setIsHolding(false);
    holdStartRef.current = null;
    setHoldProgress(0);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };

  const handleMouseLeave = () => {
    handleMouseUp();
  };

  const handleClose = () => {
    if (deleteMutation.isPending) return;
    setDeleteFiles(false);
    setHoldProgress(0);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Delete "{projectName}"?</h2>
                  <p className="text-xs text-gray-500">This action cannot be undone</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={deleteMutation.isPending}
                className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* File deletion option */}
              <div className="space-y-3">
                {/* Keep files option (default) */}
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                    !deleteFiles
                      ? 'bg-theme-primary-muted border-2 border-theme-primary/50'
                      : 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteOption"
                    checked={!deleteFiles}
                    onChange={() => setDeleteFiles(false)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-theme-primary" />
                      <span className="text-sm font-medium text-white">Keep project files</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Remove from Hatchway but keep files at:<br/>
                      <code className="text-gray-500">~/hatchway-projects/{projectSlug}</code>
                    </p>
                  </div>
                </label>

                {/* Delete files option */}
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                    deleteFiles
                      ? 'bg-red-500/20 border-2 border-red-500/50'
                      : 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteOption"
                    checked={deleteFiles}
                    onChange={() => setDeleteFiles(true)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span className="text-sm font-medium text-white">Delete everything</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Permanently delete project and all files from disk
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 p-5 border-t border-white/10 bg-black/20">
              <button
                onClick={handleClose}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>

              {/* Hold-to-delete button */}
              <button
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleMouseDown}
                onTouchEnd={handleMouseUp}
                disabled={deleteMutation.isPending}
                className={`relative px-5 py-2 text-sm font-medium rounded-lg transition-all overflow-hidden ${
                  deleteFiles
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {/* Progress fill */}
                <motion.div
                  className={`absolute inset-0 ${deleteFiles ? 'bg-red-400' : 'bg-orange-400'}`}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: holdProgress }}
                  style={{ transformOrigin: 'left' }}
                />

                {/* Button text */}
                <span className="relative z-10 flex items-center gap-2">
                  {deleteMutation.isPending ? (
                    'Deleting...'
                  ) : isHolding ? (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Hold to confirm...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Hold to Delete
                    </>
                  )}
                </span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
