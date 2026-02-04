'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, Wifi, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

export type TunnelStatus = 'connecting' | 'ready' | 'failed';

interface TunnelConnectingProps {
  status: TunnelStatus;
  tunnelUrl?: string;
  port?: number;
  onDismiss?: () => void;
}

export function TunnelConnecting({ status, tunnelUrl, port, onDismiss }: TunnelConnectingProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 via-gray-900/95 to-gray-900/95 shadow-2xl backdrop-blur-sm"
    >
      <div className="border-b border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Animated icon cluster */}
          <div className="relative flex items-center gap-1">
            <motion.div
              animate={status === 'connecting' ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20"
            >
              <Wifi className={`h-4 w-4 ${status === 'failed' ? 'text-red-400' : 'text-cyan-400'}`} />
            </motion.div>
            
            {/* Animated connection dots */}
            {status === 'connecting' && (
              <div className="flex gap-0.5 mx-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </div>
            )}
            
            {status === 'ready' && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                <ArrowRight className="h-4 w-4 text-cyan-400 mx-1" />
              </motion.div>
            )}
            
            {status === 'failed' && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
              >
                <XCircle className="h-4 w-4 text-red-400 mx-1" />
              </motion.div>
            )}
            
            <motion.div
              animate={status === 'connecting' ? { y: [0, -2, 0] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                status === 'failed' ? 'bg-red-500/20' : 'bg-blue-500/20'
              }`}
            >
              <Cloud className={`h-4 w-4 ${status === 'failed' ? 'text-red-400' : 'text-blue-400'}`} />
            </motion.div>
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {status === 'connecting' && 'Establishing Tunnel'}
              {status === 'ready' && 'Tunnel Connected'}
              {status === 'failed' && 'Connection Failed'}
            </h3>
            <AnimatePresence mode="wait">
              {status === 'connecting' && (
                <motion.p
                  key="connecting"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs shimmer-text-cyan"
                >
                  Connecting to Cloudflare edge...
                </motion.p>
              )}
              {status === 'ready' && tunnelUrl && (
                <motion.p
                  key="ready"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-cyan-400/80 font-mono truncate"
                >
                  {tunnelUrl.replace('https://', '')}
                </motion.p>
              )}
              {status === 'failed' && (
                <motion.p
                  key="failed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-red-400/80"
                >
                  Unable to establish tunnel connection
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex items-center gap-2">
            {port && (
              <span className="text-xs text-gray-500 font-mono">:{port}</span>
            )}
            
            {status === 'ready' && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </motion.div>
            )}
            
            {status !== 'connecting' && onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1 text-gray-400 hover:text-white transition-colors rounded hover:bg-white/10"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        
        {/* Progress indicator - pulsing line for connecting, solid for ready */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-800">
          {status === 'connecting' ? (
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: '50%' }}
            />
          ) : status === 'ready' ? (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 0.5 }}
              className="h-full bg-gradient-to-r from-cyan-500 to-green-500"
            />
          ) : (
            <div className="h-full w-full bg-red-500/50" />
          )}
        </div>
      </div>
    </motion.div>
  );
}
