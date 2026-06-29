"use client";

import { useState } from "react";
import { ArrowRight, Info, Cloud, Home } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { TerminalCodeBlock } from "../TerminalCodeBlock";

interface InstallStepProps {
  onNext: () => void;
  onSkip: () => void;
}

type Mode = "remote" | "local";

const tabs: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: "remote", label: "Remote runner", icon: <Cloud className="w-4 h-4" /> },
  { id: "local", label: "Local", icon: <Home className="w-4 h-4" /> },
];

export function InstallStep({ onNext, onSkip }: InstallStepProps) {
  const [mode, setMode] = useState<Mode>("remote");

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
          Let&apos;s get you set up
        </h2>
        <p className="text-muted-foreground">
          Connect a runner to start building on hatchway.sh
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border">
        {tabs.map((tab) => {
          const isActive = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={`relative flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="install-tab-active"
                  className="absolute inset-0 rounded-md bg-background shadow-sm border border-border"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                {tab.icon}
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {mode === "remote" ? (
          <motion.div
            key="remote"
            className="space-y-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <TerminalCodeBlock
              code="npx @hatchway/cli runner"
              title="Connect a runner"
            />

            <div className="p-4 rounded-lg bg-theme-gradient-muted border-theme-primary/20">
              <div className="flex gap-3">
                <div className="shrink-0">
                  <div className="w-8 h-8 rounded-full bg-theme-primary-muted flex items-center justify-center">
                    <Info className="w-4 h-4 text-theme-primary" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    What does this do?
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This runs the Hatchway runner directly with{" "}
                    <code className="px-1.5 py-0.5 bg-muted rounded text-theme-accent">npx</code> &mdash; no
                    install required. It opens your browser to sign in, then connects your machine to
                    hatchway.sh to process builds using your local Claude Code, Codex, or OpenCode Zen
                    (experimental) subscription.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="local"
            className="space-y-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <TerminalCodeBlock
              code="curl -fsSL https://hatchway.sh/install | bash"
              title="Install Hatchway CLI"
            />

            <div className="p-4 rounded-lg bg-theme-gradient-muted border-theme-primary/20">
              <div className="flex gap-3">
                <div className="shrink-0">
                  <div className="w-8 h-8 rounded-full bg-theme-primary-muted flex items-center justify-center">
                    <Info className="w-4 h-4 text-theme-primary" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Run the full stack locally
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Install the{" "}
                    <code className="px-1.5 py-0.5 bg-muted rounded text-theme-accent">hatchway</code> CLI,
                    then run <code className="px-1.5 py-0.5 bg-muted rounded text-theme-accent">hatchway</code> and
                    select Local mode to run the web app and runner on your own machine. Your code and keys
                    never leave your computer.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Requirements */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
          Node.js 18+
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
          npm or pnpm
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
          macOS / Linux / WSL
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </Button>
        <Button
          type="button"
          onClick={onNext}
          className="bg-theme-gradient hover:opacity-90 text-white px-6"
        >
          {mode === "remote" ? "Continue" : "I've installed it"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </motion.div>
  );
}
