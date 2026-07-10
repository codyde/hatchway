"use client"

import { useEffect, useRef, useCallback, useState } from "react"

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

type Monster = {
  x: number
  y: number
  vx: number
  w: number
  h: number
  hp: number
  maxHp: number
  facing: 1 | -1
  hitFlash: number
  points: number
  kind: "slime" | "bat" | "brute"
}

type PowerOrb = {
  x: number
  y: number
  vy: number
  kind: "shield" | "life" | "rage"
  bob: number
  life: number
}

const MAX_LIVES = 3
const GRAVITY = 1800
const MOVE_SPEED = 280
const JUMP_V = -620
const HI_KEY = "hatchway-platform-hi"

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export default function PlatformFighterGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [lives, setLives] = useState(MAX_LIVES)
  const [shields, setShields] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [wave, setWave] = useState(1)

  const scoreRef = useRef(0)
  const highScoreRef = useRef(0)
  const livesRef = useRef(MAX_LIVES)
  const shieldsRef = useRef(0)
  const gameOverRef = useRef(false)
  const invulnRef = useRef(0)
  const rageRef = useRef(0)
  const keysRef = useRef<Set<string>>(new Set())
  const restartRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(HI_KEY) || "0")
      if (!Number.isNaN(saved)) {
        highScoreRef.current = saved
        setHighScore(saved)
      }
    } catch {
      // ignore
    }
  }, [])

  const bumpScore = useCallback((pts: number) => {
    scoreRef.current += pts
    setScore(scoreRef.current)
    setWave(1 + Math.floor(scoreRef.current / 1200))
    if (scoreRef.current > highScoreRef.current) {
      highScoreRef.current = scoreRef.current
      setHighScore(scoreRef.current)
      try {
        localStorage.setItem(HI_KEY, String(scoreRef.current))
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let running = true
    let last = performance.now()
    let w = 0
    let h = 0
    let dpr = 1
    let groundY = 0
    let elapsed = 0
    let spawnTimer = 1
    let orbTimer = 5
    let scroll = 0
    let shake = 0

    const hero = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      w: 28,
      h: 40,
      facing: 1 as 1 | -1,
      onGround: false,
      attackT: 0,
      attackCd: 0,
      anim: 0,
    }

    const monsters: Monster[] = []
    const particles: Particle[] = []
    const orbs: PowerOrb[] = []

    const explode = (x: number, y: number, color: string, count = 10, power = 1) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = rand(50, 200) * power
        particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: rand(0.2, 0.6),
          maxLife: 0.6,
          color,
          size: rand(1.5, 3.5) * power,
        })
      }
    }

    const resetRun = () => {
      monsters.length = 0
      particles.length = 0
      orbs.length = 0
      scoreRef.current = 0
      livesRef.current = MAX_LIVES
      shieldsRef.current = 0
      gameOverRef.current = false
      invulnRef.current = 1
      rageRef.current = 0
      elapsed = 0
      spawnTimer = 0.8
      orbTimer = 5
      scroll = 0
      hero.x = w * 0.35
      hero.y = groundY - hero.h
      hero.vx = 0
      hero.vy = 0
      hero.facing = 1
      hero.onGround = true
      hero.attackT = 0
      hero.attackCd = 0
      setScore(0)
      setLives(MAX_LIVES)
      setShields(0)
      setGameOver(false)
      setWave(1)
    }
    restartRef.current = resetRun

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(320, Math.floor(rect.width))
      h = Math.max(240, Math.floor(rect.height))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      groundY = h * 0.78
      if (hero.x === 0) {
        hero.x = w * 0.35
        hero.y = groundY - hero.h
      } else {
        hero.x = clamp(hero.x, 20, w - 40)
        hero.y = Math.min(hero.y, groundY - hero.h)
      }
    }

    const difficulty = () => 1 + elapsed * 0.04 + scoreRef.current * 0.0003

    const spawnMonster = () => {
      const d = difficulty()
      const fromLeft = Math.random() > 0.5
      const roll = Math.random()
      let kind: Monster["kind"] = "slime"
      if (roll > 0.78 && d > 1.4) kind = "brute"
      else if (roll > 0.45) kind = "bat"

      const dims =
        kind === "brute"
          ? { w: 40, h: 48, hp: 4 + Math.floor(d), points: 250, speed: 70 }
          : kind === "bat"
            ? { w: 26, h: 22, hp: 1 + (d > 2 ? 1 : 0), points: 150, speed: 140 }
            : { w: 30, h: 28, hp: 2 + (d > 2.5 ? 1 : 0), points: 100, speed: 95 }

      monsters.push({
        x: fromLeft ? -40 : w + 20,
        y: kind === "bat" ? groundY - dims.h - rand(30, 90) : groundY - dims.h,
        vx: (fromLeft ? 1 : -1) * dims.speed * (0.85 + d * 0.12),
        w: dims.w,
        h: dims.h,
        hp: dims.hp,
        maxHp: dims.hp,
        facing: fromLeft ? 1 : -1,
        hitFlash: 0,
        points: dims.points,
        kind,
      })
    }

    const spawnOrb = () => {
      const roll = Math.random()
      orbs.push({
        x: rand(60, w - 60),
        y: groundY - rand(70, 140),
        vy: 0,
        kind: roll > 0.7 ? "life" : roll > 0.35 ? "shield" : "rage",
        bob: rand(0, Math.PI * 2),
        life: 10,
      })
    }

    const attack = () => {
      if (hero.attackCd > 0 || gameOverRef.current) return
      hero.attackT = 0.18
      hero.attackCd = rageRef.current > 0 ? 0.18 : 0.32
      const reach = rageRef.current > 0 ? 58 : 46
      const ax = hero.facing === 1 ? hero.x + hero.w : hero.x - reach
      const ay = hero.y + 8
      const aw = reach
      const ah = hero.h - 12

      for (let i = monsters.length - 1; i >= 0; i--) {
        const m = monsters[i]
        if (
          ax < m.x + m.w &&
          ax + aw > m.x &&
          ay < m.y + m.h &&
          ay + ah > m.y
        ) {
          m.hp -= rageRef.current > 0 ? 2 : 1
          m.hitFlash = 0.15
          m.vx += hero.facing * 120
          explode(m.x + m.w / 2, m.y + m.h / 2, "#fde68a", 8, 0.7)
          if (m.hp <= 0) {
            bumpScore(m.points)
            explode(m.x + m.w / 2, m.y + m.h / 2, "#fb7185", 16, 1.1)
            if (Math.random() < 0.1) {
              orbs.push({
                x: m.x + m.w / 2,
                y: m.y,
                vy: 0,
                kind: Math.random() > 0.5 ? "shield" : "rage",
                bob: 0,
                life: 8,
              })
            }
            monsters.splice(i, 1)
            shake = 0.2
          }
        }
      }
    }

    const hurtHero = (mx: number, my: number) => {
      if (invulnRef.current > 0 || gameOverRef.current) return
      if (shieldsRef.current > 0) {
        shieldsRef.current -= 1
        setShields(shieldsRef.current)
        explode(mx, my, "#38bdf8", 14, 1)
        invulnRef.current = 0.7
        shake = 0.25
        return
      }
      livesRef.current -= 1
      setLives(livesRef.current)
      explode(hero.x + hero.w / 2, hero.y + hero.h / 2, "#fb7185", 18, 1.2)
      invulnRef.current = 1.2
      shake = 0.4
      if (livesRef.current <= 0) {
        gameOverRef.current = true
        setGameOver(true)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "r", "j"].includes(
          k
        ) ||
        e.code === "Space"
      ) {
        e.preventDefault()
      }
      keysRef.current.add(k)
      if (k === " " || e.code === "Space") keysRef.current.add("space")
      if ((k === "r" || k === "enter") && gameOverRef.current) resetRun()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      keysRef.current.delete(k)
      if (k === " " || e.code === "Space") keysRef.current.delete("space")
    }
    const onPointerDown = () => {
      canvas.focus()
      if (gameOverRef.current) resetRun()
      else attack()
    }

    resize()
    window.addEventListener("resize", resize)
    window.addEventListener("keydown", onKeyDown, { passive: false })
    window.addEventListener("keyup", onKeyUp)
    canvas.addEventListener("pointerdown", onPointerDown)
    canvas.tabIndex = 0
    canvas.focus()

    const loop = (now: number) => {
      if (!running) return
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      elapsed += dt
      scroll += dt * (40 + difficulty() * 12)
      spawnTimer -= dt
      orbTimer -= dt
      shake = Math.max(0, shake - dt * 6)
      invulnRef.current = Math.max(0, invulnRef.current - dt)
      rageRef.current = Math.max(0, rageRef.current - dt)
      hero.attackT = Math.max(0, hero.attackT - dt)
      hero.attackCd = Math.max(0, hero.attackCd - dt)
      hero.anim += dt

      if (!gameOverRef.current) {
        const d = difficulty()
        if (spawnTimer <= 0) {
          spawnMonster()
          if (Math.random() < Math.min(0.55, 0.15 + d * 0.08)) spawnMonster()
          spawnTimer = Math.max(0.45, 1.6 - d * 0.18)
        }
        if (orbTimer <= 0) {
          spawnOrb()
          orbTimer = rand(6, 10)
        }

        const keys = keysRef.current
        let move = 0
        if (keys.has("arrowleft") || keys.has("a")) move -= 1
        if (keys.has("arrowright") || keys.has("d")) move += 1
        hero.vx = move * MOVE_SPEED
        if (move !== 0) hero.facing = move > 0 ? 1 : -1

        if ((keys.has("arrowup") || keys.has("w")) && hero.onGround) {
          hero.vy = JUMP_V
          hero.onGround = false
        }
        if (keys.has("j") || keys.has("f") || keys.has("space") || keys.has(" ")) {
          attack()
        }

        hero.vy += GRAVITY * dt
        hero.x = clamp(hero.x + hero.vx * dt, 8, w - hero.w - 8)
        hero.y += hero.vy * dt
        if (hero.y + hero.h >= groundY) {
          hero.y = groundY - hero.h
          hero.vy = 0
          hero.onGround = true
        } else {
          hero.onGround = false
        }
      }

      for (let i = monsters.length - 1; i >= 0; i--) {
        const m = monsters[i]
        m.hitFlash = Math.max(0, m.hitFlash - dt)
        if (m.kind === "bat") {
          m.y = groundY - m.h - 50 - Math.sin(elapsed * 3 + m.x * 0.02) * 28
        }
        m.x += m.vx * dt
        if (m.x < -80 || m.x > w + 80) {
          monsters.splice(i, 1)
          continue
        }
        if (gameOverRef.current) continue
        if (
          hero.x < m.x + m.w - 6 &&
          hero.x + hero.w > m.x + 6 &&
          hero.y < m.y + m.h - 4 &&
          hero.y + hero.h > m.y + 4
        ) {
          hurtHero(m.x + m.w / 2, m.y + m.h / 2)
          m.vx *= -1
          m.facing = m.vx > 0 ? 1 : -1
        }
      }

      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i]
        o.bob += dt * 4
        o.life -= dt
        if (o.life <= 0) {
          orbs.splice(i, 1)
          continue
        }
        if (gameOverRef.current) continue
        const cx = o.x
        const cy = o.y + Math.sin(o.bob) * 4
        if (
          hero.x < cx + 14 &&
          hero.x + hero.w > cx - 14 &&
          hero.y < cy + 14 &&
          hero.y + hero.h > cy - 14
        ) {
          if (o.kind === "shield") {
            shieldsRef.current = Math.min(3, shieldsRef.current + 1)
            setShields(shieldsRef.current)
            explode(cx, cy, "#38bdf8", 12, 0.9)
          } else if (o.kind === "life") {
            livesRef.current = Math.min(MAX_LIVES, livesRef.current + 1)
            setLives(livesRef.current)
            explode(cx, cy, "#f472b6", 12, 0.9)
          } else {
            rageRef.current = 8
            explode(cx, cy, "#fbbf24", 12, 0.9)
          }
          bumpScore(40)
          orbs.splice(i, 1)
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 200 * dt
        if (p.life <= 0) particles.splice(i, 1)
      }

      const sx = shake > 0 ? rand(-2.5, 2.5) * shake : 0
      const sy = shake > 0 ? rand(-2.5, 2.5) * shake : 0
      ctx.save()
      ctx.translate(sx, sy)

      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, h)
      sky.addColorStop(0, "#0b1220")
      sky.addColorStop(0.55, "#172554")
      sky.addColorStop(1, "#1e1b4b")
      ctx.fillStyle = sky
      ctx.fillRect(-4, -4, w + 8, h + 8)

      // parallax hills
      ctx.fillStyle = "#1e293b"
      for (let i = 0; i < 6; i++) {
        const hx = ((i * 180 - scroll * 0.25) % (w + 200)) - 100
        ctx.beginPath()
        ctx.moveTo(hx, groundY)
        ctx.quadraticCurveTo(hx + 90, groundY - 70 - (i % 3) * 18, hx + 180, groundY)
        ctx.fill()
      }

      // ground
      ctx.fillStyle = "#334155"
      ctx.fillRect(0, groundY, w, h - groundY + 8)
      ctx.fillStyle = "#475569"
      ctx.fillRect(0, groundY, w, 8)
      // ground tiles
      ctx.strokeStyle = "rgba(148,163,184,0.15)"
      ctx.lineWidth = 1
      const tileOff = scroll % 40
      for (let x = -tileOff; x < w; x += 40) {
        ctx.beginPath()
        ctx.moveTo(x, groundY)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // distant moons
      ctx.globalAlpha = 0.25
      ctx.fillStyle = "#c4b5fd"
      ctx.beginPath()
      ctx.arc(w * 0.82, h * 0.18, 28, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1

      // orbs
      for (const o of orbs) {
        const cy = o.y + Math.sin(o.bob) * 4
        const color =
          o.kind === "shield" ? "#38bdf8" : o.kind === "life" ? "#f472b6" : "#fbbf24"
        ctx.globalAlpha = 0.3
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(o.x, cy, 16, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(o.x, cy, 11, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = "#0f172a"
        ctx.font = "bold 11px sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(o.kind === "shield" ? "S" : o.kind === "life" ? "+" : "R", o.x, cy + 1)
      }

      // monsters
      for (const m of monsters) {
        const flash = m.hitFlash > 0
        ctx.save()
        ctx.translate(m.x + m.w / 2, m.y + m.h / 2)
        ctx.scale(m.facing, 1)
        if (m.kind === "slime") {
          ctx.fillStyle = flash ? "#fecdd3" : "#4ade80"
          ctx.beginPath()
          ctx.ellipse(0, 4, m.w * 0.48, m.h * 0.42, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = "#052e16"
          ctx.beginPath()
          ctx.arc(-6, 0, 3, 0, Math.PI * 2)
          ctx.arc(6, 0, 3, 0, Math.PI * 2)
          ctx.fill()
        } else if (m.kind === "bat") {
          ctx.fillStyle = flash ? "#fecdd3" : "#a78bfa"
          ctx.beginPath()
          ctx.ellipse(0, 0, m.w * 0.28, m.h * 0.35, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(-4, 0)
          ctx.quadraticCurveTo(-m.w * 0.55, -10 + Math.sin(elapsed * 12) * 4, -m.w * 0.5, 8)
          ctx.lineTo(-4, 6)
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(4, 0)
          ctx.quadraticCurveTo(m.w * 0.55, -10 + Math.sin(elapsed * 12 + 1) * 4, m.w * 0.5, 8)
          ctx.lineTo(4, 6)
          ctx.fill()
        } else {
          ctx.fillStyle = flash ? "#fecdd3" : "#f97316"
          ctx.fillRect(-m.w * 0.4, -m.h * 0.4, m.w * 0.8, m.h * 0.85)
          ctx.fillStyle = "#7c2d12"
          ctx.fillRect(-m.w * 0.25, -m.h * 0.15, 6, 8)
          ctx.fillRect(m.w * 0.1, -m.h * 0.15, 6, 8)
        }
        // hp bar
        if (m.hp < m.maxHp) {
          ctx.fillStyle = "#450a0a"
          ctx.fillRect(-m.w * 0.35, -m.h * 0.55, m.w * 0.7, 4)
          ctx.fillStyle = "#ef4444"
          ctx.fillRect(-m.w * 0.35, -m.h * 0.55, m.w * 0.7 * (m.hp / m.maxHp), 4)
        }
        ctx.restore()
      }

      // hero
      const blink = invulnRef.current > 0 && Math.floor(invulnRef.current * 14) % 2 === 0
      if (!blink && (!gameOverRef.current || livesRef.current > 0)) {
        ctx.save()
        ctx.translate(hero.x + hero.w / 2, hero.y + hero.h / 2)
        ctx.scale(hero.facing, 1)

        if (shieldsRef.current > 0) {
          ctx.globalAlpha = 0.3
          ctx.strokeStyle = "#38bdf8"
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(0, 0, 30, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        // body
        ctx.fillStyle = rageRef.current > 0 ? "#fbbf24" : "#38bdf8"
        ctx.fillRect(-10, -14, 20, 28)
        // head
        ctx.fillStyle = "#e2e8f0"
        ctx.beginPath()
        ctx.arc(0, -20, 9, 0, Math.PI * 2)
        ctx.fill()
        // legs
        const legSwing = hero.onGround && Math.abs(hero.vx) > 10 ? Math.sin(hero.anim * 12) * 6 : 0
        ctx.fillStyle = "#1e293b"
        ctx.fillRect(-8, 12, 6, 12 + legSwing * 0.2)
        ctx.fillRect(2, 12, 6, 12 - legSwing * 0.2)

        // sword
        const swing = hero.attackT > 0 ? (1 - hero.attackT / 0.18) * Math.PI * 0.7 : 0.15
        ctx.save()
        ctx.translate(8, -2)
        ctx.rotate(-0.4 + swing)
        ctx.fillStyle = "#94a3b8"
        ctx.fillRect(0, -3, 34 + (rageRef.current > 0 ? 10 : 0), 6)
        ctx.fillStyle = "#f8fafc"
        ctx.fillRect(28, -5, 10, 10)
        ctx.fillStyle = "#b45309"
        ctx.fillRect(-6, -4, 8, 8)
        ctx.restore()

        ctx.restore()
      }

      for (const p of particles) {
        const t = p.life / p.maxLife
        ctx.globalAlpha = t
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (gameOverRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.45)"
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = "#fda4af"
        ctx.font = "bold 28px sans-serif"
        ctx.textAlign = "center"
        ctx.fillText("DEFEATED", w / 2, h / 2 - 18)
        ctx.fillStyle = "#e2e8f0"
        ctx.font = "14px sans-serif"
        ctx.fillText(`Score ${scoreRef.current}  ·  Press R or click to retry`, w / 2, h / 2 + 14)
      }

      ctx.restore()
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      canvas.removeEventListener("pointerdown", onPointerDown)
    }
  }, [bumpScore])

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden bg-[#0b1220]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full outline-none cursor-pointer"
        aria-label="Platform fighter loading mini-game"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 pr-28">
        <div className="rounded-lg border border-sky-500/30 bg-black/40 px-3 py-2 backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-[0.2em] text-sky-300/80">Building</p>
          <p className="text-sm font-semibold text-white">Blade Rush · Wave {wave}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <span className="text-rose-300">{"♥".repeat(Math.max(0, lives))}</span>
            <span className="text-rose-300/30">{"♥".repeat(Math.max(0, MAX_LIVES - lives))}</span>
            {shields > 0 && (
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-sky-300">
                S×{shields}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-right backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">Score</p>
          <p className="font-mono text-lg font-bold text-amber-300 tabular-nums">{score}</p>
          <p className="text-[10px] text-gray-500">
            HI <span className="font-mono text-gray-300">{highScore}</span>
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
        <div className="rounded-full border border-white/10 bg-black/50 px-4 py-1.5 text-[11px] text-gray-300 backdrop-blur-sm">
          <span className="text-white/90">A/D</span> move ·{" "}
          <span className="text-white/90">W</span> jump ·{" "}
          <span className="text-white/90">Space/J</span> sword · grab power-ups
          {gameOver ? " · R retry" : ""}
        </div>
      </div>
    </div>
  )
}
