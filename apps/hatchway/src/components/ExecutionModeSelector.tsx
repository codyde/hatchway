'use client';

import { Monitor, Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExecutionMode, type ExecutionMode } from '@/contexts/ExecutionModeContext';

interface ExecutionModeSelectorProps {
  /** Called after the mode changes (e.g. to persist on the project). */
  onChange?: (mode: ExecutionMode) => void;
  disabled?: boolean;
  className?: string;
}

const OPTIONS: { value: ExecutionMode; label: string; icon: typeof Monitor; title: string }[] = [
  { value: 'local', label: 'Local', icon: Monitor, title: 'Run the build on a connected runner' },
  { value: 'sandbox', label: 'Sandbox', icon: Boxes, title: 'Run the build in an ephemeral Railway sandbox' },
];

export function ExecutionModeSelector({ onChange, disabled, className }: ExecutionModeSelectorProps) {
  const { executionMode, setExecutionMode } = useExecutionMode();

  const select = (mode: ExecutionMode) => {
    if (disabled || mode === executionMode) return;
    setExecutionMode(mode);
    onChange?.(mode);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Execution mode"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon, title }) => {
        const active = value === executionMode;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            onClick={() => select(value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
