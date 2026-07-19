'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Info, MessageSquare } from 'lucide-react';
import type { ActivityItem } from '@/types/generation';

interface ActivityFeedProps {
  items: ActivityItem[];
  isActive?: boolean;
  emptyLabel?: string;
}

function formatTime(ts: Date | string | number | undefined): string {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StatusIcon({ item }: { item: ActivityItem }) {
  if (item.status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 text-theme-primary animate-spin flex-shrink-0" />;
  }
  if (item.status === 'error') {
    return <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />;
  }
  if (item.status === 'success' || item.status === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 dark:text-green-400 flex-shrink-0" />;
  }
  if (item.status === 'warning') {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />;
  }
  if (item.kind === 'text') {
    return <MessageSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
  }
  if (item.kind === 'status') {
    return <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
}

function kindPrefix(item: ActivityItem): string {
  if (item.kind === 'tool') return '›';
  if (item.kind === 'todo') return '•';
  if (item.kind === 'text') return '·';
  return '·';
}

export function ActivityFeed({
  items,
  isActive = false,
  emptyLabel = 'Waiting for agent activity…',
}: ActivityFeedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 48;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length, items[items.length - 1]?.id, items[items.length - 1]?.status]);

  if (!items.length) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
        {isActive ? <Loader2 className="h-4 w-4 animate-spin text-theme-primary" /> : null}
        <span className={isActive ? 'shimmer-text' : ''}>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="max-h-[360px] overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const isError = item.status === 'error';
          const isRunning = item.status === 'running';
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-start gap-2 py-1 px-1 rounded ${
                isError
                  ? 'bg-red-500/5 text-red-300'
                  : isRunning
                    ? 'bg-theme-primary/5'
                    : 'text-muted-foreground'
              }`}
            >
              <span className="text-muted-foreground/70 w-3 flex-shrink-0 pt-0.5">
                {kindPrefix(item)}
              </span>
              <StatusIcon item={item} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`truncate ${
                      item.kind === 'tool'
                        ? isRunning
                          ? 'shimmer-text text-foreground'
                          : 'text-foreground/90'
                        : item.kind === 'todo'
                          ? 'text-foreground font-medium'
                          : isError
                            ? 'text-red-300'
                            : 'text-foreground/80'
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.detail && item.kind !== 'status' && (
                    <span className="truncate text-muted-foreground/80">{item.detail}</span>
                  )}
                </div>
                {item.kind === 'status' && item.detail && (
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">{item.detail}</div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 tabular-nums pt-0.5">
                {formatTime(item.timestamp)}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {isActive && (
        <div className="flex items-center gap-2 py-1.5 px-1 text-muted-foreground">
          <span className="w-3" />
          <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-primary" />
          <span className="shimmer-text">working…</span>
        </div>
      )}
    </div>
  );
}
