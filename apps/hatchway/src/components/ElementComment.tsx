'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Settings2, X, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';

interface ElementCommentProps {
  element: {
    selector: string;
    tagName: string;
    className: string;
    textContent: string;
    boundingRect: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
  };
  position: { x: number; y: number };
  containerBounds?: { top: number; left: number; right: number; bottom: number };
  onSubmit: (prompt: string) => void;
  onClose: () => void;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
}

export default function ElementComment({
  element,
  position,
  containerBounds,
  onSubmit,
  onClose,
  status = 'pending',
}: ElementCommentProps) {
  const [prompt, setPrompt] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ensure we only render portal on client side
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt);
      setPrompt('');
      // Window will auto-minimize when status changes to 'processing'
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // Position calculations:
  // Circle is centered at click position (position.x, position.y)
  const circleSize = 32;
  const commentWidth = showDetails ? 400 : 280;
  const commentHeight = showDetails ? 280 : 160; // Approximate heights
  const padding = 10; // Minimum padding from edges

  // Default positions
  let circleLeft = position.x - (circleSize / 2);
  let circleTop = position.y - (circleSize / 2);
  let commentLeft = circleLeft + circleSize + 2; // Default: right of circle
  let commentTop = circleTop;
  let flipToLeft = false;

  // Boundary adjustments if containerBounds provided
  if (containerBounds) {
    // Clamp circle position within container
    circleLeft = Math.max(containerBounds.left + padding, Math.min(circleLeft, containerBounds.right - circleSize - padding));
    circleTop = Math.max(containerBounds.top + padding, Math.min(circleTop, containerBounds.bottom - circleSize - padding));

    // Check if comment would overflow right edge
    if (circleLeft + circleSize + commentWidth + padding > containerBounds.right) {
      // Flip comment to left side of circle
      flipToLeft = true;
      commentLeft = circleLeft - commentWidth - 2;
    } else {
      commentLeft = circleLeft + circleSize + 2;
    }

    // Check if comment would overflow left edge when flipped
    if (flipToLeft && commentLeft < containerBounds.left + padding) {
      // Can't fit on either side, just position at left edge
      commentLeft = containerBounds.left + padding;
    }

    // Vertical bounds check - ensure comment doesn't go above or below container
    if (commentTop + commentHeight > containerBounds.bottom - padding) {
      commentTop = containerBounds.bottom - commentHeight - padding;
    }
    if (commentTop < containerBounds.top + padding) {
      commentTop = containerBounds.top + padding;
    }
  }

  // Don't render until mounted (client-side only for portal)
  if (!mounted) return null;

  const content = (
    <>
      {/* Only show comment window for pending status - no status orbs */}
      {status === 'pending' && (
        <>
          {/* Anchor circle at click position */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed z-[100]"
            style={{
              left: `${circleLeft}px`,
              top: `${circleTop}px`,
            }}
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 bg-theme-primary-muted border-theme-primary">
              <div className="w-2 h-2 rounded-full bg-theme-primary"></div>
            </div>
          </motion.div>

          {/* Comment window - to top-right of circle */}
        <motion.div
          initial={{ scale: 0, opacity: 0, x: -10 }}
          animate={{ scale: 1, opacity: 1, x: 0 }}
          exit={{ scale: 0, opacity: 0, x: -10 }}
          className="fixed z-[101] bg-gradient-to-br from-gray-900 to-gray-800 border border-theme-primary/30 rounded-lg shadow-2xl"
          style={{
            left: `${commentLeft}px`,
            top: `${commentTop}px`,
            width: `${commentWidth}px`,
          }}
        >
          {/* Header */}
          <div className="border-b border-theme-primary/20 px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-theme-primary"></div>
              <span className="text-xs font-medium text-gray-400">
                {element.tagName}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                title={showDetails ? 'Hide details' : 'Show details'}
              >
                <Settings2 className={`w-3.5 h-3.5 transition-colors ${showDetails ? 'text-theme-primary' : 'text-gray-500'}`} />
              </button>
              <button
                onClick={onClose}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Details (expandable) */}
          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-b border-theme-primary/10 overflow-hidden"
              >
                <div className="p-3 space-y-2 text-xs">
                  <div>
                    <span className="text-gray-500">Selector:</span>
                    <code className="ml-2 text-theme-primary font-mono">{element.selector}</code>
                  </div>
                  {element.className && (
                    <div>
                      <span className="text-gray-500">Classes:</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {element.className.split(' ').slice(0, 5).map((cls, i) => (
                          <span key={i} className="bg-theme-primary-muted px-1.5 py-0.5 rounded text-theme-primary font-mono">
                            {cls}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {element.textContent && (
                    <div>
                      <span className="text-gray-500">Text:</span>
                      <span className="ml-2 text-gray-300">{element.textContent.substring(0, 50)}...</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input */}
          <div className="p-3 space-y-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your change..."
              rows={2}
              className="w-full px-3 py-2 bg-black/40 border border-theme-primary/30 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-theme-primary/50 resize-none"
              autoFocus
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">⌘↵</div>
              <Button
                onClick={handleSubmit}
                disabled={!prompt.trim()}
                size="sm"
                className="h-6 px-2 text-xs bg-theme-primary-muted border-theme-primary/30 hover:bg-theme-primary-muted text-theme-primary"
              >
                <Send className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </motion.div>
        </>
      )}
    </>
  );

  // Use portal to render at document body level, escaping any transform containers
  // This fixes position:fixed issues when parent has CSS transforms (e.g., framer-motion)
  return createPortal(content, document.body);
}
