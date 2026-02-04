import * as React from "react"

const MOBILE_BREAKPOINT = 768
const NARROW_DESKTOP_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

// Returns true for screens between mobile and narrow desktop (768px - 1024px)
// Used to show sidebar as overlay instead of pushing content
export function useIsNarrowDesktop() {
  const [isNarrowDesktop, setIsNarrowDesktop] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(
      `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${NARROW_DESKTOP_BREAKPOINT - 1}px)`
    )
    const onChange = () => {
      const width = window.innerWidth
      setIsNarrowDesktop(width >= MOBILE_BREAKPOINT && width < NARROW_DESKTOP_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    onChange() // Initial check
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isNarrowDesktop
}
