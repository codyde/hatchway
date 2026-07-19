'use client';

import { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import type { ActivityItem } from '@/types/generation';

interface ActivityFeedProps {
  items: ActivityItem[];
  isActive?: boolean;
  emptyLabel?: string;
  /** Prefer chat-style Claude lines; tools stay out of this view. */
  agentLabel?: string;
}

function formatTime(ts: Date | string | number | undefined): string {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Chat panel shows Claude narrative + important status only — never tool rows. */
function isChatVisible(item: ActivityItem): boolean {
  if (item.kind === 'text') return Boolean(item.label?.trim());
  if (item.kind === 'status') {
    // Keep progress/error status; drop noisy "Build started" style noise if empty
    return Boolean(item.label?.trim());
  }
  return false;
}

export function ActivityFeed({
  items,
  isActive = false,
  emptyLabel = 'Waiting for agent activity…',
  agentLabel = 'Claude',
}: ActivityFeedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const chatItems = useMemo(() => items.filter(isChatVisible), [items]);

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
  }, [
    chatItems.length,
    chatItems[chatItems.length - 1]?.id,
    chatItems[chatItems.length - 1]?.label,
    chatItems[chatItems.length - 1]?.status,
  ]);

  if (!chatItems.length) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
        {isActive ? <Loader2 className="h-4 w-4 animate-spin text-theme-primary" /> : null}
        <span className={isActive ? 'shimmer-text' : ''}>
          {isActive ? `${agentLabel} is working…` : emptyLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="max-h-[420px] overflow-y-auto px-3 py-3 space-y-2"
    >
      <AnimatePresence initial={false}>
        {chatItems.map((item) => {
          if (item.kind === 'text') {
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg px-3 py-2.5 bg-theme-primary/5 border border-theme-primary/10"
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

          // status rows
          const isError = item.status === 'error';
          const isSuccess = item.status === 'success' || item.status === 'completed';
          const isWarning = item.status === 'warning';
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                isError
                  ? 'bg-red-500/10 text-red-200'
                  : isWarning
                    ? 'bg-amber-500/10 text-amber-100'
                    : isSuccess
                      ? 'bg-green-500/10 text-green-200'
                      : 'bg-white/5 text-muted-foreground'
              }`}
            >
              {isError ? (
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              ) : isSuccess ? (
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              ) : (
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="leading-relaxed break-words">{item.label}</p>
                {item.detail ? (
                  <p className="text-[10px] opacity-70 mt-0.5">{item.detail}</p>
                ) : null}
              </div>
              <span className="text-[10px] opacity-50 flex-shrink-0 tabular-nums">
                {formatTime(item.timestamp)}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {isActive && (
        <div className="flex items-center gap-2 py-1.5 px-1 text-muted-foreground text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-primary" />
          <span className="shimmer-text">{agentLabel} is working…</span>
        </div>
      )}
    </div>
  );
}
