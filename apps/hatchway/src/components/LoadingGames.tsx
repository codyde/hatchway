"use client"

import { useEffect, useState } from "react"
import { Gamepad2 } from "lucide-react"
import StarfoxLoadingGame from "./StarfoxLoadingGame"
import PlatformFighterGame from "./PlatformFighterGame"

type GameId = "starfox" | "platform"

const STORAGE_KEY = "hatchway-loading-game"
const GAMES: { id: GameId; label: string; nextLabel: string }[] = [
  { id: "starfox", label: "Meteor Run", nextLabel: "Blade Rush" },
  { id: "platform", label: "Blade Rush", nextLabel: "Meteor Run" },
]

export default function LoadingGames() {
  const [game, setGame] = useState<GameId>("starfox")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === "starfox" || saved === "platform") setGame(saved)
    } catch {
      // ignore
    }
    setReady(true)
  }, [])

  const current = GAMES.find((g) => g.id === game) || GAMES[0]

  const switchGame = () => {
    const next: GameId = game === "starfox" ? "platform" : "starfox"
    setGame(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  if (!ready) {
    return <div className="w-full h-full bg-[#070716]" />
  }

  return (
    <div className="relative w-full h-full">
      {game === "starfox" ? <StarfoxLoadingGame /> : <PlatformFighterGame />}

      <div className="absolute top-4 right-4 z-20">
        <button
          type="button"
          onClick={switchGame}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-md transition hover:border-violet-400/40 hover:bg-black/70"
          title={`Switch to ${current.nextLabel}`}
        >
          <Gamepad2 className="h-3.5 w-3.5 text-violet-300" />
          <span>Switch Game</span>
          <span className="text-white/40">→</span>
          <span className="text-violet-200">{current.nextLabel}</span>
        </button>
      </div>
    </div>
  )
}
