import { useState, useCallback } from 'react';

export interface ElementEdit {
  id: string;
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
  prompt: string;
  position: { x: number; y: number };
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export function useElementEdits() {
  const [edits, setEdits] = useState<Map<string, ElementEdit>>(new Map());

  const addEdit = useCallback((element: any, prompt: string, position: { x: number; y: number }) => {
    const id = `edit-${Date.now()}-${Math.random()}`;

    const edit: ElementEdit = {
      id,
      element,
      prompt,
      position,
      status: 'pending',
      createdAt: new Date(),
    };

    setEdits((prev) => new Map(prev).set(id, edit));
    return id;
  }, []);

  const updateEditStatus = useCallback((id: string, status: ElementEdit['status'], error?: string) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const edit = next.get(id);
      if (edit) {
        next.set(id, {
          ...edit,
          status,
          error,
          completedAt: status === 'completed' || status === 'failed' ? new Date() : edit.completedAt,
        });
      }
      return next;
    });
  }, []);

  const removeEdit = useCallback((id: string) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setEdits((prev) => {
      const next = new Map(prev);
      for (const [id, edit] of next.entries()) {
        if (edit.status === 'completed') {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  return {
    edits: Array.from(edits.values()),
    addEdit,
    updateEditStatus,
    removeEdit,
    clearCompleted,
  };
}
