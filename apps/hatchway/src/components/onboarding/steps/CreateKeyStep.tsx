"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, AlertCircle, Check, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TerminalCodeBlock } from "../TerminalCodeBlock";

interface CreateKeyStepProps {
  onNext: (key: string) => void;
  onBack: () => void;
}

export function CreateKeyStep({ onNext, onBack }: CreateKeyStepProps) {
  const [keyName, setKeyName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/runner-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create key");
      }

      const data = await res.json();
      setCreatedKey(data.key);
    } catch (err) {
      console.error("Error creating key:", err);
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyAndNext = async () => {
    if (!createdKey) return;
    
    try {
      await navigator.clipboard.writeText(createdKey);
      setHasCopied(true);
      setTimeout(() => {
        onNext(createdKey);
      }, 300);
    } catch (err) {
      console.error("Failed to copy:", err);
      onNext(createdKey);
    }
  };

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
          Create a runner key
        </h2>
        <p className="text-muted-foreground">
          This key authenticates your runner with Hatchway
        </p>
      </div>

      <AnimatePresence mode="wait">
        {!createdKey ? (
          <motion.div
            key="create-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Create key form */}
            <form onSubmit={handleCreateKey} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="keyName" className="text-sm font-medium text-foreground">
                  Give your runner a name
                </label>
                <Input
                  id="keyName"
                  type="text"
                  placeholder="e.g., My MacBook Pro"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-12 text-base"
                  disabled={isCreating}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  This helps you identify the runner in your dashboard
                </p>
              </div>

              {/* Error message */}
              <AnimatePresence>
                {error && (
                  <motion.div 
                    className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-sm text-red-400">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                type="submit"
                disabled={isCreating || !keyName.trim()}
                className="w-full h-12 bg-theme-gradient hover:opacity-90 text-white text-base font-medium"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Creating key...
                  </>
                ) : (
                  <>
                    <Shield className="w-5 h-5 mr-2" />
                    Generate Key
                  </>
                )}
              </Button>
            </form>

            {/* Actions */}
            <div className="flex items-center justify-start pt-4">
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
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="key-created"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4"
          >
            {/* Success animation */}
            <motion.div 
              className="flex justify-center"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                <Check className="w-8 h-8 text-white" />
              </div>
            </motion.div>

            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground">Key created!</h3>
              <p className="text-sm text-muted-foreground mt-1">Copy this key - you won&apos;t see it again</p>
            </div>

            {/* Key display */}
            <TerminalCodeBlock 
              code={createdKey} 
              title="Your Runner Key"
              showPrompt={false}
            />

            {/* Warning */}
            <motion.div 
              className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                Save this key somewhere safe. For security reasons, it won&apos;t be displayed again.
              </p>
            </motion.div>

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
                onClick={handleCopyAndNext}
                className="bg-theme-gradient hover:opacity-90 text-white px-6"
              >
                {hasCopied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    Copy & Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
