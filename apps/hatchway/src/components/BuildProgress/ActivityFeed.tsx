'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Info } from 'lucide-react';
import type { ActivityItem } from '@/types/generation';

interface ActivityFeedProps {
  items: ActivityItem[];
  isActive?: boolean;
  emptyLabel?: string;
  /** Prefer chat-style Claude lines; tools stay secondary. */
  agentLabel?: string;
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
  if (item.kind === 'status') {
    return <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
}

export function ActivityFeed({
  items,
  isActive = false,
  emptyLabel = 'Waiting for agent activity…',
  agentLabel = 'Claude',
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
  }, [items.length, items[items.length - 1]?.id, items[items.length - 1]?.label, items[items.length - 1]?.status]);

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
      className="max-h-[420px] overflow-y-auto px-3 py-3 space-y-1.5"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => {
          if (item.kind === 'text') {
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg px-2.5 py-2 bg-theme-primary/5 border border-theme-primary/10"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-[11px] font-semibold tracking-wide text-theme-primary">
                    {agentLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {formatTime(item.timestamp)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                  {item.label}
                </p>
              </motion.div>
            );
          }

          const isError = item.status === 'error';
          const isRunning = item.status === 'running';
          const isTool = item.kind === 'tool';

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-start gap-2 py-1 px-1.5 rounded font-mono text-[11px] leading-relaxed ${
                isError
                  ? 'bg-red-500/5 text-red-300'
                  : isRunning
                    ? 'bg-theme-primary/5'
                    : 'text-muted-foreground'
              }`}
            >
              <StatusIcon item={item} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`truncate ${
                      isTool
                        ? isRunning
                          ? 'shimmer-text text-foreground/80'
                          : 'text-foreground/70'
                        : item.kind === 'todo'
                          ? 'text-foreground/90 font-medium'
                          : isError
                            ? 'text-red-300'
                            : 'text-foreground/70'
                    }`}
                  >
                    {isTool ? `› ${item.label}` : item.label}
                  </span>
                  {item.detail && item.kind !== 'status' && (
                    <span className="truncate text-muted-foreground/70">{item.detail}</span>
                  )}
                </div>
                {item.kind === 'status' && item.detail && (
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">{item.detail}</div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 tabular-nums pt-0.5">
                {formatTime(item.timestamp)}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {isActive && (
        <div className="flex items-center gap-2 py-1.5 px-1.5 text-muted-foreground font-mono text-[11px]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-primary" />
          <span className="shimmer-text">{agentLabel} is working…</span>
        </div>
      )}
    </div>
  );
}
