/**
 * WebSocket Connection Status Indicator
 * 
 * Shows the current state of the WebSocket connection with visual feedback
 */

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, Loader2, AlertCircle } from 'lucide-react';

interface WebSocketStatusProps {
  isConnected: boolean;
  isReconnecting: boolean;
  error: Error | null;
  onReconnect?: () => void;
}

export function WebSocketStatus({
  isConnected,
  isReconnecting,
  error,
  onReconnect,
}: WebSocketStatusProps) {
  // Only show when there's something to indicate (not connected or error)
  if (isConnected && !error) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="fixed top-4 right-4 z-50"
      >
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/95 backdrop-blur-sm border shadow-lg">
          {isReconnecting ? (
            <>
              <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
              <span className="text-sm text-yellow-400 font-medium">
                Reconnecting...
              </span>
            </>
          ) : error ? (
            <>
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400 font-medium">
                Connection error
              </span>
              {onReconnect && (
                <button
                  onClick={onReconnect}
                  className="ml-2 px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                >
                  Retry
                </button>
              )}
            </>
          ) : !isConnected ? (
            <>
              <WifiOff className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400 font-medium">
                Disconnected
              </span>
            </>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Minimal WebSocket Status Badge (for compact displays)
 */
export function WebSocketStatusBadge({
  isConnected,
  isReconnecting,
}: Pick<WebSocketStatusProps, 'isConnected' | 'isReconnecting'>) {
  return (
    <div className="flex items-center gap-1.5">
      {isConnected ? (
        <div className="flex items-center gap-1.5 text-green-400">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-medium">Live</span>
        </div>
      ) : isReconnecting ? (
        <div className="flex items-center gap-1.5 text-yellow-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span className="text-xs font-medium">Connecting</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-gray-400">
          <div className="w-2 h-2 rounded-full bg-gray-400" />
          <span className="text-xs font-medium">Offline</span>
        </div>
      )}
    </div>
  );
}

/**
 * Simple dot indicator for headers - shows connection state with just a colored dot
 * Green = connected, Yellow (pulsing) = reconnecting, Red = disconnected
 */
export function WebSocketStatusDot({
  isConnected,
  isReconnecting,
  onClick,
  className = '',
}: Pick<WebSocketStatusProps, 'isConnected' | 'isReconnecting'> & {
  onClick?: () => void;
  className?: string;
}) {
  const getStatusStyles = () => {
    if (isReconnecting) return 'bg-yellow-400 shadow-yellow-400/50 animate-pulse';
    if (isConnected) return 'bg-green-400 shadow-green-400/50';
    return 'bg-red-400 shadow-red-400/50';
  };

  const getTitle = () => {
    if (isReconnecting) return 'Reconnecting to server...';
    if (isConnected) return 'Connected - receiving live updates';
    return 'Disconnected - click to reconnect';
  };

  return (
    <button
      onClick={!isConnected && !isReconnecting ? onClick : undefined}
      disabled={isConnected || isReconnecting}
      title={getTitle()}
      className={`
        w-2.5 h-2.5 rounded-full shadow-lg transition-all duration-300
        ${getStatusStyles()}
        ${!isConnected && !isReconnecting ? 'cursor-pointer hover:scale-125' : 'cursor-default'}
        ${className}
      `}
    />
  );
}

