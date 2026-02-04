'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  onResize?: (width: number) => void;
}

export function ResizablePanel({
  children,
  defaultWidth = 400,
  minWidth = 200,
  maxWidth = 600,
  className,
  onResize,
}: ResizablePanelProps) {
  const [width, setWidth] = React.useState(defaultWidth);
  const [isResizing, setIsResizing] = React.useState(false);
  const [isDesktop, setIsDesktop] = React.useState<boolean | null>(null); // null = not yet determined (SSR)
  const [hasMounted, setHasMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(0);

  // Check if we're on desktop (lg breakpoint = 1024px) - only after mount
  React.useEffect(() => {
    setHasMounted(true);
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (!isDesktop) return;
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width, isDesktop]);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const diff = e.clientX - startXRef.current;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + diff));
      setWidth(newWidth);
      onResize?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, minWidth, maxWidth, onResize]);

  // Determine if we should apply desktop styles
  const applyDesktopStyles = hasMounted && isDesktop;

  return (
    <div
      ref={panelRef}
      className={cn('relative', className)}
      style={applyDesktopStyles ? { width: `${width}px`, flexShrink: 0 } : undefined}
    >
      {children}
      {/* Resize handle on the right edge - only show on desktop after mount */}
      {applyDesktopStyles && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'absolute top-0 right-0 w-1.5 h-full cursor-ew-resize z-10',
            'hover:bg-theme-primary-muted transition-colors',
            isResizing && 'bg-theme-primary-muted'
          )}
        />
      )}
    </div>
  );
}
