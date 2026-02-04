"use client";

import { motion } from "framer-motion";
import { Check, Terminal, Plug } from "lucide-react";

interface Step {
  id: number;
  label: string;
  icon: React.ReactNode;
}

const steps: Step[] = [
  { id: 1, label: "Install", icon: <Terminal className="w-4 h-4" /> },
  { id: 2, label: "Connect", icon: <Plug className="w-4 h-4" /> },
];

interface StepProgressProps {
  currentStep: number;
}

export function StepProgress({ currentStep }: StepProgressProps) {
  // Map step 3 (complete) to show all steps as completed
  const displayStep = currentStep === 3 ? 3 : currentStep;
  
  return (
    <div className="w-full">
      <div className="flex items-center justify-between relative">
        {/* Progress line background */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-border mx-8" />
        
        {/* Animated progress line */}
        <motion.div 
          className="absolute top-5 left-8 h-0.5 bg-theme-gradient"
          initial={{ width: 0 }}
          animate={{ 
            width: `calc(${((Math.min(displayStep, steps.length) - 1) / (steps.length - 1)) * 100}% - 4rem)` 
          }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        />

        {steps.map((step) => {
          const isCompleted = step.id < displayStep || displayStep === 3;
          const isCurrent = step.id === displayStep && displayStep !== 3;
          const isPending = step.id > displayStep;

          return (
            <div key={step.id} className="flex flex-col items-center z-10">
              {/* Step circle */}
              <motion.div
                className={`
                  relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors
                  ${isCompleted 
                    ? "bg-theme-gradient border-transparent" 
                    : isCurrent 
                      ? "bg-muted border-theme-primary" 
                      : "bg-muted border-border"
                  }
                `}
                initial={false}
                animate={isCurrent ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                {isCompleted ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  >
                    <Check className="w-5 h-5 text-white" />
                  </motion.div>
                ) : (
                  <span className={`
                    ${isCurrent ? "text-theme-primary" : "text-muted-foreground"}
                  `}>
                    {step.icon}
                  </span>
                )}
                
                {/* Pulse ring for current step */}
                {isCurrent && (
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-theme-primary"
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: 1.4, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
              </motion.div>

              {/* Step label */}
              <span className={`
                mt-2 text-xs font-medium transition-colors
                ${isCompleted || isCurrent ? "text-foreground" : "text-muted-foreground"}
              `}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
