"use client";

import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useRunner } from "@/contexts/RunnerContext";
import { ConnectRunnerStepProgress } from "./ConnectRunnerStepProgress";
import { InstallStep } from "../onboarding/steps/InstallStep";
import { ConnectStep } from "../onboarding/steps/ConnectStep";
import { RunnerConnectedStep } from "./RunnerConnectedStep";

type Step = 1 | 2 | 3;

interface ConnectRunnerWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function ConnectRunnerWizard({ open, onOpenChange, onComplete }: ConnectRunnerWizardProps) {
  const { availableRunners } = useRunner();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [hasInitialized, setHasInitialized] = useState(false);

  // If a runner connects while modal is open, jump to complete step
  useEffect(() => {
    if (availableRunners.length > 0 && currentStep < 3 && hasInitialized) {
      setCurrentStep(3);
    }
  }, [availableRunners.length, currentStep, hasInitialized]);

  // Initialize state when modal first opens
  useEffect(() => {
    if (open && !hasInitialized) {
      if (availableRunners.length > 0) {
        // If runners are already connected, start at complete
        setCurrentStep(3);
      } else {
        // Fresh start
        setCurrentStep(1);
      }
      setHasInitialized(true);
    } else if (!open) {
      setHasInitialized(false);
    }
  }, [open, availableRunners.length, hasInitialized]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleComplete = () => {
    // Reset state on completion
    setCurrentStep(1);
    onComplete?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl bg-popover border-border p-0 gap-0 overflow-hidden">
        {/* Header with progress */}
        <div className="p-6 pb-4 border-b border-border bg-theme-gradient-muted">
          <h2 className="text-lg font-semibold text-foreground mb-4">Connect a Runner</h2>
          <ConnectRunnerStepProgress currentStep={currentStep} />
        </div>

        {/* Content */}
        <div className="p-6 min-h-[400px]">
          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <InstallStep
                key="install"
                onNext={() => setCurrentStep(2)}
                onSkip={handleClose}
              />
            )}

            {currentStep === 2 && (
              <ConnectStep
                key="connect"
                onNext={() => setCurrentStep(3)}
                onBack={() => setCurrentStep(1)}
                onSkip={handleClose}
              />
            )}

            {currentStep === 3 && (
              <RunnerConnectedStep 
                key="complete"
                onComplete={handleComplete} 
              />
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
