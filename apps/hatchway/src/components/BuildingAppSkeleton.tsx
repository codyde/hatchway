"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

// Card configuration for the bento grid layout
type CardConfig = {
  id: string
  gridArea: string
  origin: string // transform-origin for scale animation
  delay: number
  content: "text" | "media" | "stats" | "header"
  shimmerOffset: number // offset for staggered shimmer timing
}

const CARDS: CardConfig[] = [
  // Row 1: Full width header card
  { id: "1", gridArea: "1 / 1 / 2 / 5", origin: "top left", delay: 0, content: "header", shimmerOffset: 0 },
  // Row 2: Two half-width cards
  { id: "2", gridArea: "2 / 1 / 3 / 3", origin: "top left", delay: 0.2, content: "media", shimmerOffset: 0.3 },
  { id: "3", gridArea: "2 / 3 / 3 / 5", origin: "top right", delay: 0.4, content: "text", shimmerOffset: 0.6 },
  // Row 3: Three cards - quarter, quarter, half
  { id: "4", gridArea: "3 / 1 / 4 / 2", origin: "left center", delay: 0.6, content: "stats", shimmerOffset: 0.15 },
  { id: "5", gridArea: "3 / 2 / 4 / 3", origin: "center", delay: 0.8, content: "stats", shimmerOffset: 0.45 },
  { id: "6", gridArea: "3 / 3 / 4 / 5", origin: "right center", delay: 1.0, content: "media", shimmerOffset: 0.75 },
  // Row 4: Full width card
  { id: "7", gridArea: "4 / 1 / 5 / 5", origin: "bottom left", delay: 1.2, content: "text", shimmerOffset: 0.2 },
  // Row 5: Half and half
  { id: "8", gridArea: "5 / 1 / 6 / 3", origin: "bottom left", delay: 1.4, content: "header", shimmerOffset: 0.5 },
  { id: "9", gridArea: "5 / 3 / 6 / 5", origin: "bottom right", delay: 1.6, content: "media", shimmerOffset: 0.8 },
]

// Calculate reverse delays for exit animation (last card exits first)
const maxDelay = Math.max(...CARDS.map((c) => c.delay))
const CARDS_WITH_EXIT_DELAY = CARDS.map((card) => ({
  ...card,
  exitDelay: maxDelay - card.delay,
}))

// Animation timing constants (in seconds)
const ANIMATION_IN_DURATION = 0.5
const HOLD_DURATION = 2500 // ms
const ANIMATION_OUT_DURATION = 0.4
const PAUSE_DURATION = 600 // ms

type AnimationPhase = "animating-in" | "holding" | "animating-out" | "paused"

export default function BuildingAppSkeleton() {
  const [phase, setPhase] = useState<AnimationPhase>("animating-in")
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    let timeout: NodeJS.Timeout

    const totalAnimateInTime = (maxDelay + ANIMATION_IN_DURATION + 0.3) * 1000 // extra time for spring settle

    if (phase === "animating-in") {
      // Wait for all cards to animate in, then hold
      timeout = setTimeout(() => {
        setPhase("holding")
      }, totalAnimateInTime)
    } else if (phase === "holding") {
      // Hold visible, then start animating out
      timeout = setTimeout(() => {
        setPhase("animating-out")
        setIsVisible(false)
      }, HOLD_DURATION)
    } else if (phase === "animating-out") {
      // Wait for cards to animate out, then pause
      const totalAnimateOutTime = (maxDelay + ANIMATION_OUT_DURATION) * 1000
      timeout = setTimeout(() => {
        setPhase("paused")
      }, totalAnimateOutTime)
    } else if (phase === "paused") {
      // Brief pause, then restart
      timeout = setTimeout(() => {
        setIsVisible(true)
        setPhase("animating-in")
      }, PAUSE_DURATION)
    }

    return () => clearTimeout(timeout)
  }, [phase])

  return (
    <div className="w-full h-full flex items-center justify-center p-6 overflow-hidden">
      <div
        className="w-full h-full grid gap-3 overflow-hidden"
        style={{
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "repeat(5, 1fr)",
        }}
      >
        <AnimatePresence mode="wait">
          {isVisible &&
            CARDS_WITH_EXIT_DELAY.map((card) => (
              <SkeletonCard
                key={card.id}
                config={card}
                phase={phase}
              />
            ))}
        </AnimatePresence>
      </div>

      {/* Shimmer and glow animation styles */}
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }

        @keyframes borderGlow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0),
                        inset 0 0 0 0 rgba(139, 92, 246, 0);
            border-color: rgba(55, 65, 81, 0.4);
          }
          50% {
            box-shadow: 0 0 20px 2px rgba(139, 92, 246, 0.15),
                        inset 0 0 12px 0 rgba(139, 92, 246, 0.05);
            border-color: rgba(139, 92, 246, 0.3);
          }
        }

        .skeleton-shimmer {
          background: linear-gradient(
            90deg,
            rgb(55 65 81) 0%,
            rgb(75 85 99) 50%,
            rgb(55 65 81) 100%
          );
          background-size: 200% 100%;
          animation: shimmer 1.5s ease-in-out infinite;
        }

        .skeleton-card-glow {
          animation: borderGlow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

type CardWithExitDelay = CardConfig & { exitDelay: number }

type SkeletonCardProps = {
  config: CardWithExitDelay
  phase: AnimationPhase
}

function SkeletonCard({ config, phase }: SkeletonCardProps) {
  const { gridArea, origin, delay, exitDelay, content, shimmerOffset } = config

  // Use spring for entrance, regular easing for exit
  const transition = phase === "animating-out"
    ? {
        duration: ANIMATION_OUT_DURATION,
        delay: exitDelay,
        ease: [0.4, 0, 1, 1], // ease-in for exit
      }
    : {
        type: "spring" as const,
        stiffness: 200,
        damping: 20,
        delay: delay,
      }

  return (
    <motion.div
      className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-4 overflow-hidden flex flex-col gap-3 skeleton-card-glow"
      style={{
        gridArea,
        transformOrigin: origin,
        // Apply shimmer offset as CSS custom property
        "--shimmer-delay": `${shimmerOffset}s`,
      } as React.CSSProperties}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={transition}
    >
      <CardContent variant={content} shimmerOffset={shimmerOffset} />
    </motion.div>
  )
}

type CardContentProps = {
  variant: CardConfig["content"]
  shimmerOffset: number
}

function CardContent({ variant, shimmerOffset }: CardContentProps) {
  // Create inline style with animation delay for staggered shimmer
  const shimmerStyle = (additionalOffset: number = 0): React.CSSProperties => ({
    animationDelay: `${shimmerOffset + additionalOffset}s`,
  })

  switch (variant) {
    case "header":
      return (
        <div className="flex flex-col gap-2 h-full justify-center">
          <div className="skeleton-shimmer h-5 w-3/4 rounded-md" style={shimmerStyle(0)} />
          <div className="skeleton-shimmer h-3 w-1/2 rounded" style={shimmerStyle(0.1)} />
        </div>
      )

    case "media":
      return (
        <div className="flex flex-col gap-3 h-full">
          <div className="skeleton-shimmer flex-1 min-h-[40px] rounded-lg" style={shimmerStyle(0)} />
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-3 w-4/5 rounded" style={shimmerStyle(0.15)} />
            <div className="skeleton-shimmer h-3 w-3/5 rounded" style={shimmerStyle(0.25)} />
          </div>
        </div>
      )

    case "stats":
      return (
        <div className="flex flex-col items-center justify-center gap-2 h-full">
          <div className="skeleton-shimmer w-10 h-10 rounded-full" style={shimmerStyle(0)} />
          <div className="skeleton-shimmer h-4 w-12 rounded" style={shimmerStyle(0.1)} />
          <div className="skeleton-shimmer h-2 w-16 rounded" style={shimmerStyle(0.2)} />
        </div>
      )

    case "text":
    default:
      return (
        <div className="flex flex-col gap-2 h-full justify-center">
          <div className="skeleton-shimmer h-3 w-full rounded" style={shimmerStyle(0)} />
          <div className="skeleton-shimmer h-3 w-5/6 rounded" style={shimmerStyle(0.08)} />
          <div className="skeleton-shimmer h-3 w-4/6 rounded" style={shimmerStyle(0.16)} />
          <div className="skeleton-shimmer h-3 w-3/4 rounded" style={shimmerStyle(0.24)} />
        </div>
      )
  }
}
