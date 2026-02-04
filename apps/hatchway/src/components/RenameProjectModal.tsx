'use client';

import { useState } from 'react';
import { X, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface RenameProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentName: string;
  onRenameComplete: () => void;
}

export default function RenameProjectModal({
  isOpen,
  onClose,
  projectId,
  currentName,
  onRenameComplete,
}: RenameProjectModalProps) {
  const [newName, setNewName] = useState(currentName);
  const [isRenaming, setIsRenaming] = useState(false);

  const handleRename = async () => {
    if (!newName.trim() || newName === currentName) {
      return;
    }

    setIsRenaming(true);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });

      if (res.ok) {
        onRenameComplete();
        onClose();
      }
    } catch (error) {
      console.error('Failed to rename project:', error);
      alert('Failed to rename project');
    } finally {
      setIsRenaming(false);
    }
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
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-xl shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Edit3 className="w-6 h-6 text-theme-primary" />
                <h2 className="text-xl font-semibold text-white">Rename Project</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <label className="block mb-2 text-sm text-gray-400">
                New Project Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-4 py-2 input-theme border rounded-lg focus:outline-none transition-colors"
                placeholder="Enter new name"
                autoFocus
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!newName.trim() || newName === currentName || isRenaming}
                className="px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRenaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
