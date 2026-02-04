'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Server, Zap, CheckCircle2, XCircle, Wifi } from 'lucide-react';

export type RestartPhase = 'stopping' | 'starting' | 'healthcheck' | 'tunnel' | 'ready' | 'failed';

interface ServerRestartingProps {
  phase: RestartPhase;
  projectName?: string;
  port?: number;
  hasTunnel?: boolean;
  onDismiss?: () => void;
}

const phaseConfig: Record<RestartPhase, {
  icon: typeof Server;
  title: string;
  subtitle: string;
  color: string;
  progressColor: string;
}> = {
  stopping: {
    icon: RotateCcw,
    title: 'Stopping Server',
    subtitle: 'Gracefully shutting down...',
    color: 'text-orange-400',
    progressColor: 'from-orange-500 to-orange-400',
  },
  starting: {
    icon: Zap,
    title: 'Starting Server',
    subtitle: 'Initializing dev server...',
    color: 'text-yellow-400',
    progressColor: 'from-orange-500 to-yellow-400',
  },
  healthcheck: {
    icon: Server,
    title: 'Health Check',
    subtitle: 'Verifying server is responding...',
    color: 'text-blue-400',
    progressColor: 'from-yellow-400 to-blue-400',
  },
  tunnel: {
    icon: Wifi,
    title: 'Creating Tunnel',
    subtitle: 'Connecting to Cloudflare edge...',
    color: 'text-cyan-400',
    progressColor: 'from-blue-400 to-cyan-400',
  },
  ready: {
    icon: CheckCircle2,
    title: 'Server Ready',
    subtitle: 'Hot reload enabled',
    color: 'text-green-400',
    progressColor: 'from-cyan-400 to-green-400',
  },
  failed: {
    icon: XCircle,
    title: 'Restart Failed',
    subtitle: 'Unable to start server',
    color: 'text-red-400',
    progressColor: 'from-red-500 to-red-400',
  },
};

// Get all phases in order (excluding failed which is a terminal state)
const phaseOrder: RestartPhase[] = ['stopping', 'starting', 'healthcheck', 'tunnel', 'ready'];

export function ServerRestarting({ 
  phase, 
  projectName, 
  port,
  hasTunnel = true,
  onDismiss 
}: ServerRestartingProps) {
  const config = phaseConfig[phase];
  const Icon = config.icon;
  
  // Filter phases based on whether tunnel is needed
  const activePhases = hasTunnel 
    ? phaseOrder 
    : phaseOrder.filter(p => p !== 'tunnel');
  
  const currentPhaseIndex = activePhases.indexOf(phase);
  const progress = phase === 'failed' 
    ? 100 
    : phase === 'ready' 
      ? 100 
      : ((currentPhaseIndex + 0.5) / activePhases.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`w-full overflow-hidden rounded-xl border shadow-2xl backdrop-blur-sm ${
        phase === 'failed' 
          ? 'border-red-500/30 bg-gradient-to-br from-red-950/40 via-gray-900/95 to-gray-900/95'
          : phase === 'ready'
            ? 'border-green-500/30 bg-gradient-to-br from-green-950/40 via-gray-900/95 to-gray-900/95'
            : 'border-orange-500/30 bg-gradient-to-br from-orange-950/40 via-gray-900/95 to-gray-900/95'
      }`}
    >
      <div className={`border-b px-4 py-3 ${
        phase === 'failed'
          ? 'border-red-500/20 bg-gradient-to-r from-red-500/10 to-orange-500/10'
          : phase === 'ready'
            ? 'border-green-500/20 bg-gradient-to-r from-green-500/10 to-cyan-500/10'
            : 'border-orange-500/20 bg-gradient-to-r from-orange-500/10 to-yellow-500/10'
      }`}>
        <div className="flex items-center gap-3">
          {/* Animated server icon with orbital ring */}
          <div className="relative">
            <motion.div 
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                phase === 'failed' ? 'bg-red-500/20' :
                phase === 'ready' ? 'bg-green-500/20' :
                'bg-orange-500/20'
              }`}
              animate={phase !== 'ready' && phase !== 'failed' ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={phase}
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0, rotate: 180 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  <Icon className={`h-5 w-5 ${config.color}`} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
            
            {/* Orbital spinning ring during restart */}
            {phase !== 'ready' && phase !== 'failed' && (
              <motion.div
                className="absolute inset-0 rounded-lg border-2 border-transparent"
                style={{
                  borderTopColor: phase === 'stopping' ? 'rgb(251 146 60)' : // orange-400
                                  phase === 'starting' ? 'rgb(250 204 21)' : // yellow-400
                                  phase === 'healthcheck' ? 'rgb(96 165 250)' : // blue-400
                                  'rgb(34 211 238)', // cyan-400
                  borderRightColor: phase === 'stopping' ? 'rgb(251 146 60 / 0.3)' :
                                    phase === 'starting' ? 'rgb(250 204 21 / 0.3)' :
                                    phase === 'healthcheck' ? 'rgb(96 165 250 / 0.3)' :
                                    'rgb(34 211 238 / 0.3)',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            )}
            
            {/* Status indicator dot */}
            <motion.div
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-gray-900 ${
                phase === 'failed' ? 'bg-red-400' :
                phase === 'ready' ? 'bg-green-400' :
                phase === 'stopping' ? 'bg-orange-400' :
                phase === 'starting' ? 'bg-yellow-400' :
                phase === 'healthcheck' ? 'bg-blue-400' :
                'bg-cyan-400'
              }`}
              animate={phase !== 'ready' && phase !== 'failed' ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{config.title}</h3>
              {projectName && (
                <span className="text-xs text-gray-500 truncate">· {projectName}</span>
              )}
            </div>
            <AnimatePresence mode="wait">
              <motion.p
                key={phase}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className={`text-xs ${
                  phase === 'ready' ? 'text-green-400/80' : 
                  phase === 'failed' ? 'text-red-400/80' :
                  'shimmer-text-orange'
                }`}
              >
                {config.subtitle}
              </motion.p>
            </AnimatePresence>
          </div>
          
          <div className="flex items-center gap-2">
            {port && (
              <span className="text-xs text-gray-500 font-mono">:{port}</span>
            )}
            
            {/* Phase indicator dots */}
            <div className="flex items-center gap-1">
              {activePhases.slice(0, -1).map((p, i) => {
                const phaseIdx = activePhases.indexOf(phase);
                const isComplete = phase === 'ready' || (phase !== 'failed' && i < phaseIdx);
                const isCurrent = p === phase;
                const isFailed = phase === 'failed';
                
                return (
                  <motion.div
                    key={p}
                    className={`h-1.5 w-1.5 rounded-full ${
                      isFailed ? 'bg-red-400' :
                      isComplete ? 'bg-green-400' :
                      isCurrent ? 'bg-orange-400' :
                      'bg-gray-600'
                    }`}
                    animate={isCurrent && !isFailed ? { scale: [1, 1.5, 1] } : {}}
                    transition={{ duration: 0.6, repeat: Infinity }}
                  />
                );
              })}
            </div>
            
            {(phase === 'ready' || phase === 'failed') && onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1 text-gray-400 hover:text-white transition-colors rounded hover:bg-white/10"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-800">
          {phase === 'failed' ? (
            <div className="h-full w-full bg-red-500/50" />
          ) : (
            <motion.div
              className={`h-full bg-gradient-to-r ${config.progressColor}`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
