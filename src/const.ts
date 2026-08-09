import "./style.css"

/* colors, icons, etc. */

const css = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export const OCEAN = css("--color-crt-bg", "#050805")
export const LAND = css("--color-land", "#101010")
export const BORDER = css("--color-border", "#d0d0cb")

export const SQUARE_ICON_SIZE = 8

/* data */

export const OMM_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h (i.e. LEO drift ~1km, not a big deal on our map)
export const OMM_CACHE_KEY = "opensats.omm.v1"
export const CELESTRAK_FETCH_DELAY_MS = 100
