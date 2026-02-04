'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface ImageAttachmentProps {
  fileName: string;
  imageSrc: string;
  onRemove?: () => void;
  showRemove?: boolean;
}

export default function ImageAttachment({
  fileName,
  imageSrc,
  onRemove,
  showRemove = false,
}: ImageAttachmentProps) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="relative inline-block">
      <div
        className="px-3 py-2 bg-theme-primary-muted border border-theme-primary/40 rounded-lg text-sm text-theme-primary cursor-pointer hover:bg-theme-primary-muted transition-colors flex items-center gap-2"
        onMouseEnter={() => setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
      >
        <span className="font-mono">{fileName}</span>
        {showRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.();
            }}
            className="hover:text-white transition-colors"
            aria-label="Remove image"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Hover preview */}
      {showPreview && (
        <div className="absolute bottom-full left-0 mb-2 z-50 p-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl">
          <img
            src={imageSrc}
            alt={fileName}
            className="max-w-sm max-h-64 object-contain"
          />
        </div>
      )}
    </div>
  );
}
