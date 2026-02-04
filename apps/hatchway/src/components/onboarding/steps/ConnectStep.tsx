"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, CheckCircle2, Wifi, HelpCircle, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TerminalCodeBlock } from "../TerminalCodeBlock";
import { useRunner } from "@/contexts/RunnerContext";

interface ConnectStepProps {
  runnerKey?: string; // Optional - for legacy key-based flow
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function ConnectStep({ runnerKey, onNext, onBack, onSkip }: ConnectStepProps) {
  const { availableRunners } = useRunner();
  const [includeRunnerId, setIncludeRunnerId] = useState(false);
  const [runnerId, setRunnerId] = useState("");
  const [hasConnected, setHasConnected] = useState(false);
  const [waitingTime, setWaitingTime] = useState(0);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);

  // If we have a runnerKey prop, use the legacy key-based command
  // Otherwise use the new OAuth-based command
  const useOAuthFlow = !runnerKey;
  
  // Build the command based on options
  const baseCommand = useOAuthFlow
    ? "hatchway runner"
    : `hatchway runner --secret ${runnerKey}`;
  const commandWithId = runnerId.trim() 
    ? `${baseCommand} --runner-id ${runnerId.trim()}`
    : baseCommand;
  const displayCommand = includeRunnerId ? commandWithId : baseCommand;

  // Watch for runner connection
  useEffect(() => {
    if (availableRunners.length > 0 && !hasConnected) {
      setHasConnected(true);
      setTimeout(() => {
        onNext();
      }, 1500);
    }
  }, [availableRunners, hasConnected, onNext]);

  // Track waiting time
  useEffect(() => {
    if (!hasConnected) {
      const interval = setInterval(() => {
        setWaitingTime((t) => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [hasConnected]);

  // Show troubleshooting after 30 seconds
  useEffect(() => {
    if (waitingTime >= 30 && !showTroubleshooting) {
      setShowTroubleshooting(true);
    }
  }, [waitingTime, showTroubleshooting]);

  return (
    <motion.div 
      className="space-y-6"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      {/* Hero section */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground">
          Connect your runner
        </h2>
        <p className="text-muted-foreground">
          {useOAuthFlow 
            ? "Run this command - it will open your browser to sign in"
            : "Run this command in a new terminal window"
          }
        </p>
      </div>

      {/* Main command */}
      <TerminalCodeBlock 
        code={displayCommand} 
        title="Start Runner"
      />

      {/* OAuth flow explanation */}
      {useOAuthFlow && (
        <div className="flex items-start gap-3 p-4 bg-theme-primary-muted rounded-lg border border-theme-primary/20">
          <ExternalLink className="w-5 h-5 text-theme-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Automatic sign-in</p>
            <p className="text-xs text-muted-foreground">
              A browser window will open automatically for authentication. 
              Sign in with GitHub or Sentry and you&apos;ll be connected instantly.
            </p>
          </div>
        </div>
      )}
      
      {/* Runner ID option */}
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={includeRunnerId}
              onChange={(e) => setIncludeRunnerId(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-5 h-5 rounded border-2 border-border peer-checked:border-theme-primary peer-checked:bg-theme-primary transition-colors flex items-center justify-center">
              {includeRunnerId && (
                <motion.svg
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-3 h-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </motion.svg>
              )}
            </div>
          </div>
          <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
            Add a custom runner ID (optional)
          </span>
        </label>
        
        <AnimatePresence>
          {includeRunnerId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Input
                type="text"
                placeholder="e.g., my-macbook"
                value={runnerId}
                onChange={(e) => setRunnerId(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Connection status */}
      <motion.div 
        className={`p-4 rounded-lg border-2 transition-all duration-500 ${
          hasConnected 
            ? "bg-green-500/10 border-green-500/50" 
            : "bg-muted/50 border-border"
        }`}
        animate={hasConnected ? { scale: [1, 1.02, 1] } : {}}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasConnected ? (
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 500 }}
              >
                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
              </motion.div>
            ) : (
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-muted-foreground" />
                </div>
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-theme-primary/50"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
            )}
            <div>
              <p className={`font-medium ${hasConnected ? "text-green-400" : "text-foreground"}`}>
                {hasConnected ? "Runner connected!" : "Waiting for connection..."}
              </p>
              {!hasConnected && (
                <p className="text-xs text-muted-foreground">
                  Listening for your runner
                </p>
              )}
            </div>
          </div>
          {!hasConnected && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs font-mono">{waitingTime}s</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Troubleshooting */}
      <AnimatePresence>
        {showTroubleshooting && !hasConnected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg"
          >
            <div className="flex items-start gap-3">
              <HelpCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-300">Taking a while?</p>
                <ul className="text-xs text-amber-200/80 space-y-1">
                  <li>Make sure you copied the full command</li>
                  <li>Check that the CLI installed successfully</li>
                  {useOAuthFlow && <li>Complete the sign-in in your browser</li>}
                  <li>Ensure you have an internet connection</li>
                  <li>Try running <code className="px-1 bg-black/30 rounded">hatchway --version</code> to verify installation</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </Button>
      </div>
    </motion.div>
  );
}
