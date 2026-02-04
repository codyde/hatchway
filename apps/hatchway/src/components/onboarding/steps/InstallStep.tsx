"use client";

import { ArrowRight, Info } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { TerminalCodeBlock } from "../TerminalCodeBlock";

interface InstallStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export function InstallStep({ onNext, onSkip }: InstallStepProps) {
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
          Install the Hatchway CLI to run builds on your machine
        </p>
      </div>

      {/* Install command */}
      <TerminalCodeBlock 
        code="curl -fsSL https://hatchway.sh/install | bash" 
        title="Install Hatchway CLI"
      />

      {/* Info card */}
      <motion.div 
        className="p-4 rounded-lg bg-theme-gradient-muted border-theme-primary/20"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex gap-3">
          <div className="shrink-0">
            <div className="w-8 h-8 rounded-full bg-theme-primary-muted flex items-center justify-center">
              <Info className="w-4 h-4 text-theme-primary" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              What does this install?
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The <code className="px-1.5 py-0.5 bg-muted rounded text-theme-accent">hatchway</code> CLI
              allows you to run Hatchway locally, or start this runner to deploy using the SaaS Hatchway. 
              It leverages your local Claude Code, Codex, or OpenCode Zen (experimental) subscription to build your applications.
            </p>
          </div>
        </div>
      </motion.div>

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
          I&apos;ve installed it
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </motion.div>
  );
}
