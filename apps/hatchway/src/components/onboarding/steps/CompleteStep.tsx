"use client";

import { CheckCircle2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useRunner } from "@/contexts/RunnerContext";

interface CompleteStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

export function CompleteStep({ onComplete, onBack }: CompleteStepProps) {
  const { availableRunners } = useRunner();
  const connectedRunner = availableRunners[0];

  return (
    <motion.div 
      className="space-y-6 relative"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      {/* Success animation */}
      <div className="flex flex-col items-center text-center space-y-4">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
        >
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <motion.div
              className="absolute inset-0 rounded-full bg-green-500/30"
              initial={{ scale: 1 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 1, repeat: 2 }}
            />
          </div>
        </motion.div>

        <div>
          <h2 className="text-2xl font-bold text-foreground">Runner Connected!</h2>
          {connectedRunner && (
            <motion.p 
              className="text-muted-foreground mt-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              Runner <span className="text-green-400 font-medium">&quot;{connectedRunner.runnerId}&quot;</span> is ready
            </motion.p>
          )}
        </div>
      </div>

      {/* Connected status */}
      <motion.div 
        className="flex items-center justify-center gap-2 py-2 px-4 bg-green-500/10 border border-green-500/30 rounded-full mx-auto w-fit"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-sm text-green-400 font-medium">Connected & Ready</span>
      </motion.div>

      {/* Info */}
      <motion.div 
        className="p-4 rounded-lg bg-theme-gradient-muted border-theme-primary/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <p className="text-sm text-foreground">
          Your runner is now connected and ready to process builds. You can start building projects right away!
        </p>
      </motion.div>

      {/* Action */}
      <div className="flex items-center justify-center pt-4">
        <Button
          type="button"
          onClick={onComplete}
          className="bg-theme-gradient hover:opacity-90 text-white px-8 h-12 text-base font-medium"
        >
          Start Building
          <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </motion.div>
  );
}
