'use client';

import { motion } from 'framer-motion';
import { Loader2, Server, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ServerRestartProgressProps {
  projectName?: string;
  port?: number;
  hasTunnel?: boolean;
}

type RestartPhase = 'stopping' | 'cleaning' | 'starting' | 'healthcheck' | 'tunnel' | 'complete';

export function ServerRestartProgress({ 
  projectName, 
  port,
  hasTunnel = false 
}: ServerRestartProgressProps) {
  const [phase, setPhase] = useState<RestartPhase>('stopping');
  const [dots, setDots] = useState('');

  // Simulate phase progression (in real usage, this would be driven by events)
  useEffect(() => {
    const phases: RestartPhase[] = hasTunnel 
      ? ['stopping', 'cleaning', 'starting', 'healthcheck', 'tunnel']
      : ['stopping', 'cleaning', 'starting', 'healthcheck'];

    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % phases.length;
      setPhase(phases[currentIndex]);
    }, 1500);

    return () => clearInterval(interval);
  }, [hasTunnel]);

  // Animated dots for loading effect
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const phaseConfig: Record<RestartPhase, { icon: React.ReactNode; text: string; color: string }> = {
    stopping: {
      icon: <Server className="h-4 w-4" />,
      text: 'Stopping server',
      color: 'text-orange-400'
    },
    cleaning: {
      icon: <WifiOff className="h-4 w-4" />,
      text: 'Cleaning up port and tunnel',
      color: 'text-yellow-400'
    },
    starting: {
      icon: <Server className="h-4 w-4" />,
      text: 'Starting fresh server',
      color: 'text-blue-400'
    },
    healthcheck: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      text: 'Running health check',
      color: 'text-theme-primary'
    },
    tunnel: {
      icon: <Wifi className="h-4 w-4" />,
      text: 'Recreating tunnel',
      color: 'text-green-400'
    },
    complete: {
      icon: <Server className="h-4 w-4" />,
      text: 'Server ready',
      color: 'text-green-400'
    }
  };

  const currentPhase = phaseConfig[phase];

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full p-4 rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-950/40 via-gray-900/95 to-gray-900/95 shadow-2xl backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
          <span className="text-sm font-medium text-gray-200">
            Restarting Server
          </span>
        </div>
        {projectName && (
          <span className="text-xs text-gray-500">{projectName}</span>
        )}
      </div>

      {/* Progress indicator */}
      <div className="mb-3">
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full progress-theme"
            initial={{ width: '0%' }}
            animate={{ 
              width: phase === 'stopping' ? '20%' 
                : phase === 'cleaning' ? '40%'
                : phase === 'starting' ? '60%'
                : phase === 'healthcheck' ? '80%'
                : phase === 'tunnel' ? '90%'
                : '100%'
            }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />
        </div>
      </div>

      {/* Current phase */}
      <motion.div
        key={phase}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10 }}
        className="flex items-center gap-2"
      >
        <span className={`${currentPhase.color}`}>
          {currentPhase.icon}
        </span>
        <span className="text-sm shimmer-text">
          {currentPhase.text}{dots}
        </span>
        {port && phase !== 'stopping' && phase !== 'cleaning' && (
          <span className="text-xs text-gray-500 ml-auto">
            Port {port}
          </span>
        )}
      </motion.div>

      {/* Additional info */}
      <div className="mt-3 pt-3 border-t border-gray-800/50">
        <p className="text-xs text-gray-500 leading-relaxed">
          {phase === 'stopping' && 'Gracefully shutting down the dev server...'}
          {phase === 'cleaning' && 'Killing processes on port and closing tunnel...'}
          {phase === 'starting' && 'Spawning new dev server process...'}
          {phase === 'healthcheck' && 'Verifying server is responding...'}
          {phase === 'tunnel' && 'Creating new Cloudflare tunnel...'}
          {phase === 'complete' && 'Server is running and ready!'}
        </p>
      </div>
    </motion.div>
  );
}
