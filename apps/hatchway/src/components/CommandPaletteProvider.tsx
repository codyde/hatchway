'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CommandPalette } from './CommandPalette';
import { useCommandPalette } from '@/hooks/useCommandPalette';

interface CommandPaletteProviderProps {
  children: React.ReactNode;
  onRenameProject?: (project: { id: string; name: string }) => void;
  onDeleteProject?: (project: { id: string; name: string; slug: string }) => void;
}

export function CommandPaletteProvider({ children, onRenameProject, onDeleteProject }: CommandPaletteProviderProps) {
  const { isOpen, open, close, toggle } = useCommandPalette();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command/Ctrl + K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }

      // Escape key
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggle, close]);

  return (
    <>
      {children}
      {mounted && createPortal(
        <CommandPalette
          open={isOpen}
          onOpenChange={(open) => (open ? open() : close())}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />,
        document.body
      )}
    </>
  );
}
