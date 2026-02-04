'use client';

import { MousePointer2 } from 'lucide-react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

interface SelectionModeProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

/**
 * SelectionMode is now a pure UI component (just the toggle button).
 * The message listener for element selection has been moved to PreviewPanel
 * so it works regardless of whether this button is rendered (hideControls={true/false}).
 */
export default function SelectionMode({ isEnabled, onToggle }: SelectionModeProps) {
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        <button
          onClick={() => onToggle(!isEnabled)}
          className={`p-1.5 rounded-md transition-all ${
            isEnabled
              ? 'bg-theme-primary-muted text-theme-primary border border-theme-primary/50 hover:bg-theme-primary/30'
              : 'hover:bg-white/10'
          }`}
        >
          <MousePointer2 className={`w-4 h-4 ${isEnabled ? 'text-theme-primary' : 'text-gray-400'}`} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto bg-gray-900 border-white/20 text-xs text-gray-200" side="bottom">
        {isEnabled ? 'Click an element in the preview' : 'Select Element'}
      </HoverCardContent>
    </HoverCard>
  );
}
