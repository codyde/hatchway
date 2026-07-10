"use client"

import { useEffect, useRef, useCallback, useState } from "react"

type Vec = { x: number; y: number }

type Bullet = Vec & { vy: number }
type Meteor = Vec & {
  vx: number
  vy: number
  r: number
  rot: number
  spin: number
  hp: number
  points: number
}
type Particle = Vec & {
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}
type Star = Vec & { z: number; speed: number; size: number }

const SHIP_W = 28
const SHIP_H = 34
const BULLET_SPEED = 620
const SHIP_SPEED = 380
const FIRE_COOLDOWN = 0.12

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export default function StarfoxLoadingGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const scoreRef = useRef(0)
  const highScoreRef = useRef(0)

  const keysRef = useRef<Set<string>>(new Set())
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  })

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("hatchway-starfox-hi") || "0")
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
    if (scoreRef.current > highScoreRef.current) {
      highScoreRef.current = scoreRef.current
      setHighScore(scoreRef.current)
      try {
        localStorage.setItem("hatchway-starfox-hi", String(scoreRef.current))
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

    const ship: Vec & { flash: number } = { x: 0, y: 0, flash: 0 }
    const bullets: Bullet[] = []
    const meteors: Meteor[] = []
    const particles: Particle[] = []
    const stars: Star[] = []
    let fireCd = 0
    let spawnTimer = 0
    let shake = 0
    let elapsed = 0

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

      if (ship.x === 0 && ship.y === 0) {
        ship.x = w / 2
        ship.y = h * 0.78
      } else {
        ship.x = clamp(ship.x, 24, w - 24)
        ship.y = clamp(ship.y, 40, h - 24)
      }

      if (stars.length === 0) {
        for (let i = 0; i < 90; i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            z: rand(0.2, 1),
            speed: rand(20, 120),
            size: rand(0.6, 2.2),
          })
        }
      }
    }

    const spawnMeteor = () => {
      const sizeRoll = Math.random()
      const r = sizeRoll > 0.85 ? rand(22, 32) : sizeRoll > 0.45 ? rand(14, 22) : rand(9, 14)
      const hp = r > 24 ? 3 : r > 16 ? 2 : 1
      meteors.push({
        x: rand(r + 8, w - r - 8),
        y: -r - 10,
        vx: rand(-40, 40),
        vy: rand(90, 170) + elapsed * 2,
        r,
        rot: rand(0, Math.PI * 2),
        spin: rand(-2.5, 2.5),
        hp,
        points: hp * 100,
      })
    }

    const explode = (x: number, y: number, color: string, count = 12, power = 1) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = rand(40, 220) * power
        particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: rand(0.25, 0.7),
          maxLife: rand(0.25, 0.7),
          color,
          size: rand(1.5, 4) * power,
        })
      }
    }

    const fire = () => {
      if (fireCd > 0) return
      fireCd = FIRE_COOLDOWN
      bullets.push({ x: ship.x - 7, y: ship.y - SHIP_H * 0.35, vy: -BULLET_SPEED })
      bullets.push({ x: ship.x + 7, y: ship.y - SHIP_H * 0.35, vy: -BULLET_SPEED })
      // muzzle flash particles
      explode(ship.x, ship.y - SHIP_H * 0.4, "#a78bfa", 4, 0.35)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d"].includes(k) ||
        e.code === "Space"
      ) {
        e.preventDefault()
      }
      keysRef.current.add(k)
      if (k === " " || e.code === "Space") keysRef.current.add("space")
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      keysRef.current.delete(k)
      if (k === " " || e.code === "Space") keysRef.current.delete("space")
    }
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = e.clientX - rect.left
      mouseRef.current.y = e.clientY - rect.top
    }
    const onPointerDown = (e: PointerEvent) => {
      mouseRef.current.active = true
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = e.clientX - rect.left
      mouseRef.current.y = e.clientY - rect.top
      canvas.focus()
    }
    const onPointerUp = () => {
      mouseRef.current.active = false
    }

    resize()
    window.addEventListener("resize", resize)
    window.addEventListener("keydown", onKeyDown, { passive: false })
    window.addEventListener("keyup", onKeyUp)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointerup", onPointerUp)
    canvas.tabIndex = 0
    canvas.focus()

    const loop = (now: number) => {
      if (!running) return
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      elapsed += dt
      fireCd = Math.max(0, fireCd - dt)
      spawnTimer -= dt
      shake = Math.max(0, shake - dt * 8)

      // difficulty ramp
      const spawnEvery = Math.max(0.35, 1.1 - elapsed * 0.015)
      if (spawnTimer <= 0) {
        spawnMeteor()
        if (Math.random() > 0.65) spawnMeteor()
        spawnTimer = spawnEvery
      }

      // movement
      const keys = keysRef.current
      let mx = 0
      let my = 0
      if (keys.has("arrowleft") || keys.has("a")) mx -= 1
      if (keys.has("arrowright") || keys.has("d")) mx += 1
      if (keys.has("arrowup") || keys.has("w")) my -= 1
      if (keys.has("arrowdown") || keys.has("s")) my += 1

      if (mouseRef.current.active) {
        const dx = mouseRef.current.x - ship.x
        const dy = mouseRef.current.y - ship.y
        const dist = Math.hypot(dx, dy)
        if (dist > 6) {
          mx += (dx / dist) * Math.min(1, dist / 80)
          my += (dy / dist) * Math.min(1, dist / 80)
        }
      }

      const len = Math.hypot(mx, my) || 1
      ship.x = clamp(ship.x + (mx / len) * SHIP_SPEED * dt, 22, w - 22)
      ship.y = clamp(ship.y + (my / len) * SHIP_SPEED * dt, 36, h - 22)
      ship.flash = Math.max(0, ship.flash - dt)

      if (keys.has("space")) fire()

      // stars
      for (const s of stars) {
        s.y += s.speed * s.z * dt
        if (s.y > h + 4) {
          s.y = -4
          s.x = Math.random() * w
        }
      }

      // bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]
        b.y += b.vy * dt
        if (b.y < -20) bullets.splice(i, 1)
      }

      // meteors
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        m.x += m.vx * dt
        m.y += m.vy * dt
        m.rot += m.spin * dt
        if (m.x < m.r) {
          m.x = m.r
          m.vx *= -1
        }
        if (m.x > w - m.r) {
          m.x = w - m.r
          m.vx *= -1
        }
        if (m.y > h + m.r + 40) {
          meteors.splice(i, 1)
          continue
        }

        // ship collision
        const dx = m.x - ship.x
        const dy = m.y - (ship.y - 4)
        if (dx * dx + dy * dy < (m.r + 10) * (m.r + 10)) {
          meteors.splice(i, 1)
          explode(m.x, m.y, "#fb7185", 18, 1.2)
          ship.flash = 0.35
          shake = 0.45
          scoreRef.current = Math.max(0, scoreRef.current - 50)
          setScore(scoreRef.current)
          continue
        }

        // bullet hits
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j]
          const bdx = m.x - b.x
          const bdy = m.y - b.y
          if (bdx * bdx + bdy * bdy < (m.r + 3) * (m.r + 3)) {
            bullets.splice(j, 1)
            m.hp -= 1
            explode(b.x, b.y, "#c4b5fd", 6, 0.5)
            if (m.hp <= 0) {
              bumpScore(m.points)
              explode(m.x, m.y, "#fbbf24", 16 + Math.floor(m.r / 2), 1 + m.r / 30)
              explode(m.x, m.y, "#f97316", 8, 0.8)
              meteors.splice(i, 1)
              shake = Math.min(0.5, shake + 0.12)
            }
            break
          }
        }
      }

      // particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.98
        p.vy *= 0.98
        if (p.life <= 0) particles.splice(i, 1)
      }

      // draw
      const sx = shake > 0 ? rand(-3, 3) * shake : 0
      const sy = shake > 0 ? rand(-3, 3) * shake : 0
      ctx.save()
      ctx.translate(sx, sy)

      // space background
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, "#070716")
      grad.addColorStop(0.55, "#0d0a24")
      grad.addColorStop(1, "#12081f")
      ctx.fillStyle = grad
      ctx.fillRect(-4, -4, w + 8, h + 8)

      // subtle nebula
      ctx.globalAlpha = 0.12
      const neb = ctx.createRadialGradient(w * 0.25, h * 0.2, 10, w * 0.25, h * 0.2, w * 0.45)
      neb.addColorStop(0, "#7c3aed")
      neb.addColorStop(1, "transparent")
      ctx.fillStyle = neb
      ctx.fillRect(0, 0, w, h)
      const neb2 = ctx.createRadialGradient(w * 0.8, h * 0.65, 10, w * 0.8, h * 0.65, w * 0.4)
      neb2.addColorStop(0, "#db2777")
      neb2.addColorStop(1, "transparent")
      ctx.fillStyle = neb2
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1

      // stars
      for (const s of stars) {
        ctx.globalAlpha = 0.35 + s.z * 0.65
        ctx.fillStyle = "#e2e8f0"
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size * s.z, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // bullets
      for (const b of bullets) {
        const g = ctx.createLinearGradient(b.x, b.y + 10, b.x, b.y - 8)
        g.addColorStop(0, "rgba(167,139,250,0)")
        g.addColorStop(0.4, "#a78bfa")
        g.addColorStop(1, "#f5f3ff")
        ctx.strokeStyle = g
        ctx.lineWidth = 2.5
        ctx.lineCap = "round"
        ctx.beginPath()
        ctx.moveTo(b.x, b.y + 8)
        ctx.lineTo(b.x, b.y - 6)
        ctx.stroke()
      }

      // meteors
      for (const m of meteors) {
        ctx.save()
        ctx.translate(m.x, m.y)
        ctx.rotate(m.rot)

        // glow
        ctx.globalAlpha = 0.25
        ctx.fillStyle = "#f97316"
        ctx.beginPath()
        ctx.arc(0, 0, m.r * 1.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1

        // rocky body
        ctx.fillStyle = "#57534e"
        ctx.strokeStyle = "#a8a29e"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        const spikes = 7
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * Math.PI * 2
          const rr = m.r * (0.78 + ((i * 37) % 5) * 0.05)
          const px = Math.cos(a) * rr
          const py = Math.sin(a) * rr
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // crater
        ctx.fillStyle = "#44403c"
        ctx.beginPath()
        ctx.arc(-m.r * 0.2, -m.r * 0.15, m.r * 0.22, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(m.r * 0.25, m.r * 0.2, m.r * 0.14, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // particles
      for (const p of particles) {
        const t = p.life / p.maxLife
        ctx.globalAlpha = t
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // ship
      drawShip(ctx, ship.x, ship.y, ship.flash > 0 && Math.floor(ship.flash * 20) % 2 === 0)

      // engine trail
      if (Math.random() > 0.3) {
        particles.push({
          x: ship.x + rand(-3, 3),
          y: ship.y + SHIP_H * 0.28,
          vx: rand(-12, 12),
          vy: rand(40, 90),
          life: rand(0.15, 0.35),
          maxLife: 0.35,
          color: Math.random() > 0.5 ? "#38bdf8" : "#a78bfa",
          size: rand(1.5, 3),
        })
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
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointerup", onPointerUp)
    }
  }, [bumpScore])

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden bg-[#070716]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full outline-none cursor-crosshair"
        aria-label="Starfox loading mini-game"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="rounded-lg border border-violet-500/30 bg-black/40 px-3 py-2 backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300/80">Building</p>
          <p className="text-sm font-semibold text-white">Fly & blast meteors</p>
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
          <span className="text-white/90">WASD</span> / arrows move ·{" "}
          <span className="text-white/90">Space</span> fire · drag to steer
        </div>
      </div>
    </div>
  )
}

function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, flash: boolean) {
  ctx.save()
  ctx.translate(x, y)

  // shadow glow
  ctx.globalAlpha = 0.35
  ctx.fillStyle = "#6366f1"
  ctx.beginPath()
  ctx.ellipse(0, 8, 18, 10, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // wings
  ctx.fillStyle = flash ? "#fda4af" : "#4f46e5"
  ctx.beginPath()
  ctx.moveTo(-4, 4)
  ctx.lineTo(-SHIP_W * 0.55, 14)
  ctx.lineTo(-6, 10)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(4, 4)
  ctx.lineTo(SHIP_W * 0.55, 14)
  ctx.lineTo(6, 10)
  ctx.closePath()
  ctx.fill()

  // fuselage
  const body = ctx.createLinearGradient(0, -SHIP_H * 0.45, 0, SHIP_H * 0.35)
  body.addColorStop(0, flash ? "#fecdd3" : "#e0e7ff")
  body.addColorStop(0.45, flash ? "#fb7185" : "#818cf8")
  body.addColorStop(1, flash ? "#e11d48" : "#3730a3")
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.moveTo(0, -SHIP_H * 0.48)
  ctx.lineTo(10, 4)
  ctx.lineTo(6, SHIP_H * 0.28)
  ctx.lineTo(-6, SHIP_H * 0.28)
  ctx.lineTo(-10, 4)
  ctx.closePath()
  ctx.fill()

  // canopy
  ctx.fillStyle = flash ? "#fff" : "#67e8f9"
  ctx.beginPath()
  ctx.ellipse(0, -2, 4.5, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  // wing guns
  ctx.fillStyle = "#c4b5fd"
  ctx.fillRect(-SHIP_W * 0.42, 8, 3, 8)
  ctx.fillRect(SHIP_W * 0.42 - 3, 8, 3, 8)

  // engine glow
  ctx.fillStyle = "#38bdf8"
  ctx.globalAlpha = 0.85
  ctx.beginPath()
  ctx.moveTo(-4, SHIP_H * 0.28)
  ctx.lineTo(0, SHIP_H * 0.28 + 10 + Math.random() * 4)
  ctx.lineTo(4, SHIP_H * 0.28)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.restore()
}
