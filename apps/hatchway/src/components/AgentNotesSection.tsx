'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TextMessage } from '@/types/generation';

interface AgentNotesSectionProps {
  textByTodo: Record<number, TextMessage[]>;
  defaultExpanded?: boolean;
}

/**
 * Collapsible section showing agent reasoning notes
 * Filters out very short notes and dedupes consecutive similar notes
 */
export function AgentNotesSection({ textByTodo, defaultExpanded = false }: AgentNotesSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Flatten all notes, filter short ones, and dedupe consecutive similar notes
  const filteredNotes = useMemo(() => {
    const allNotes = Object.entries(textByTodo)
      .sort(([a], [b]) => parseInt(a) - parseInt(b)) // Sort by todo index
      .flatMap(([, notes]) => notes)
      .filter(note => note.text && note.text.trim().length >= 20); // Filter very short notes

    // Dedupe consecutive similar notes (same first 50 chars)
    const deduped: TextMessage[] = [];
    for (const note of allNotes) {
      const lastNote = deduped[deduped.length - 1];
      const currentPrefix = note.text.trim().substring(0, 50);
      const lastPrefix = lastNote?.text.trim().substring(0, 50);
      
      if (currentPrefix !== lastPrefix) {
        deduped.push(note);
      }
    }

    return deduped;
  }, [textByTodo]);

  if (filteredNotes.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gray-500 hover:text-gray-400 transition-colors"
      >
        <MessageSquare className="w-3 h-3" />
        <span>Agent notes ({filteredNotes.length})</span>
        {isExpanded ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pl-3 border-l border-gray-700/50">
              {filteredNotes.map((note, idx) => (
                <p
                  key={note.id || idx}
                  className="text-xs text-gray-400 leading-relaxed"
                >
                  {note.text.length > 500 ? `${note.text.substring(0, 500)}...` : note.text}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Inline display of the most recent agent note (for active builds)
 */
export function ActiveAgentNote({ textByTodo, activeTodoIndex }: { 
  textByTodo: Record<number, TextMessage[]>; 
  activeTodoIndex: number;
}) {
  const recentNote = useMemo(() => {
    // Get notes for current todo, or fall back to most recent from any todo
    const currentTodoNotes = textByTodo[activeTodoIndex] || [];
    if (currentTodoNotes.length > 0) {
      return currentTodoNotes[currentTodoNotes.length - 1];
    }

    // Fallback: get most recent note from any todo
    const allNotes = Object.values(textByTodo).flat();
    return allNotes.length > 0 ? allNotes[allNotes.length - 1] : null;
  }, [textByTodo, activeTodoIndex]);

  if (!recentNote || recentNote.text.trim().length < 20) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 pt-3 border-t border-white/5"
    >
      <div className="flex items-start gap-2">
        <MessageSquare className="w-3 h-3 text-gray-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-400 leading-relaxed italic">
          {recentNote.text.length > 200 ? `${recentNote.text.substring(0, 200)}...` : recentNote.text}
        </p>
      </div>
    </motion.div>
  );
}
