"use client";

import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";
import { motion } from "framer-motion";

interface TerminalCodeBlockProps {
  code: string;
  title?: string;
  showPrompt?: boolean;
  className?: string;
}

export function TerminalCodeBlock({ 
  code, 
  title = "Terminal", 
  showPrompt = true,
  className = "" 
}: TerminalCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className={`rounded-lg overflow-hidden onboarding-terminal ${className}`}>
      {/* Terminal title bar - always dark */}
      <div className="onboarding-terminal-header flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <div className="flex items-center gap-1.5 ml-3 onboarding-terminal-title">
            <Terminal className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{title}</span>
          </div>
        </div>
        
        {/* Copy button */}
        <motion.button
          onClick={handleCopy}
          className="onboarding-terminal-copy flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </motion.button>
      </div>
      
      {/* Terminal content - always dark with light text */}
      <div className="onboarding-terminal-content p-4 font-mono text-sm overflow-x-auto">
        <div className="flex items-start gap-2">
          {showPrompt && (
            <span className="text-green-400 select-none shrink-0">$</span>
          )}
          <code className="onboarding-terminal-code break-all">{code}</code>
        </div>
      </div>
    </div>
  );
}
