'use client';

import { motion } from 'framer-motion';
import { Loader2, Sparkles } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

interface ProjectMetadataCardProps {
  projectName: string;
  description?: string | null;
  icon?: string | null;
  slug?: string;
}

export default function ProjectMetadataCard({
  projectName,
  description,
  icon,
  slug,
}: ProjectMetadataCardProps) {
  // Get the icon component dynamically
  const IconComponent = icon && (LucideIcons as any)[icon]
    ? (LucideIcons as any)[icon]
    : Sparkles;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full p-6 rounded-xl border-theme-primary/30 theme-card-header backdrop-blur-sm"
    >
      <div className="flex items-start gap-4">
        {/* Icon with pulsing animation */}
        <div className="flex-shrink-0">
          <motion.div
            animate={{
              scale: [1, 1.05, 1],
              opacity: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="w-12 h-12 rounded-xl bg-theme-gradient-muted flex items-center justify-center border-theme-primary/30"
          >
            <IconComponent className="w-6 h-6 text-theme-primary" />
          </motion.div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-white">{projectName}</h3>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="w-4 h-4 text-theme-primary" />
            </motion.div>
          </div>

          {description && (
            <p className="text-sm text-gray-400 mb-3 leading-relaxed">
              {description}
            </p>
          )}

          {slug && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-mono bg-gray-800/50 px-2 py-1 rounded">
                {slug}
              </span>
            </div>
          )}

          {/* Loading indicator */}
          <div className="mt-4 flex items-center gap-2 text-sm text-theme-primary">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-theme-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-theme-primary"></span>
            </span>
            <span>Analyzing project requirements...</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
