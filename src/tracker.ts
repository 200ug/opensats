import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl"
import {
    degreesLat,
    degreesLong,
    eciToGeodetic,
    gstime,
    json2satrec,
    propagate,
    type OMMJsonObject,
    type SatRec
} from "satellite.js"
import {
    CELESTRAK_FETCH_DELAY_MS,
    OMM_CACHE_KEY,
    OMM_CACHE_TTL,
    SQUARE_ICON_SIZE,
    SAT_HIT_RADIUS
} from "./const"

interface SatelliteEntry {
    norad_id: number
    name: string
    img_path?: string
    platform?: string
    data: {
        portal_name: string
        url: string
    }
}

interface SatelliteCategory {
    name: string
    color: string
    description: string
    satellites: SatelliteEntry[]
}

interface SatelliteRegistry {
    categories: SatelliteCategory[]
}

export interface SatelliteRecord {
    noradId: number
    name: string
    category: string
    color: string
}

interface LoadedSatellites {
    categories: Omit<CategoryMeta, "count">[]
    satellites: SatelliteRecord[]
}

async function loadSatellites(): Promise<LoadedSatellites> {
    const registry: SatelliteRegistry = await (await fetch("/data/satellites.json")).json()

    const categories = registry.categories.map((cat) => ({
        id: cat.name,
        label: cat.name,
        color: cat.color
    }))

    const satellites = registry.categories.flatMap((cat) =>
        cat.satellites.map((sat) => ({
            noradId: sat.norad_id,
            name: sat.name,
            category: cat.name,
            color: cat.color
        }))
    )

    return { categories, satellites }
}

interface TrackedSatellite extends SatelliteRecord {
    satrec: SatRec
}

interface GeoJsonPoint {
    type: "Point"
    coordinates: [number, number]
}

interface GeoJsonFeature {
    type: "Feature"
    geometry: GeoJsonPoint
    properties: Record<string, unknown>
}

interface FeatureCollection {
    type: "FeatureCollection"
    features: GeoJsonFeature[]
}

interface GeoJsonLineString {
    type: "LineString"
    coordinates: [number, number][]
}

interface GeoJsonLineFeature {
    type: "Feature"
    geometry: GeoJsonLineString
    properties: Record<string, unknown>
}

interface GeoJsonLineCollection {
    type: "FeatureCollection"
    features: GeoJsonLineFeature[]
}

interface OmmCache {
    fetchedAt: number
    sats: {
        noradId: number
        omm: OMMJsonObject
    }[]
}

const emptyFc = (): FeatureCollection => ({ type: "FeatureCollection", features: [] })
const emptyLineFc = (): GeoJsonLineCollection => ({ type: "FeatureCollection", features: [] })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function readCache(): OmmCache | null {
    try {
        const raw = localStorage.getItem(OMM_CACHE_KEY)
        return raw ? (JSON.parse(raw) as OmmCache) : null
    } catch {
        return null
    }
}

function writeCache(sats: OmmCache["sats"]) {
    try {
        const cache: OmmCache = { fetchedAt: Date.now(), sats }
        localStorage.setItem(OMM_CACHE_KEY, JSON.stringify(cache))
    } catch {
        // quota exceeded etc. -> fine, just no caching
    }
}

const toMap = (cache: OmmCache) => new Map(cache.sats.map((s) => [s.noradId, s.omm]))

// OMM records keyed by NORAD ID
// fresh cache wins, otherwise refetch from CelesTrak
async function getOmmData(wantedIds: number[]): Promise<Map<number, OMMJsonObject>> {
    const cached = readCache()

    if (cached && Date.now() - cached.fetchedAt < OMM_CACHE_TTL) return toMap(cached)

    const fetched: OmmCache["sats"] = []

    for (const id of wantedIds) {
        try {
            // NOTE: CelesTrak doesn't offer batch request functionality,
            //       thus we must perform the requests one by one
            const res = await fetch(
                `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=json`
            )
            const omm = res.ok ? ((await res.json())[0] as OMMJsonObject | undefined) : undefined

            if (omm) {
                fetched.push({ noradId: id, omm })
            } else {
                console.warn(`[tracker] no OMM data for ${id}`)
            }
        } catch {
            console.warn(`[tracker] fetch failed for ${id}`)
        }

        await sleep(CELESTRAK_FETCH_DELAY_MS)
    }

    if (fetched.length > 0) {
        writeCache(fetched)
        return toMap({ fetchedAt: Date.now(), sats: fetched })
    }

    // unreachable -> stale cache beats nothing
    if (cached) console.warn("[tracker] CelesTrak unreachable, using stale cache")

    return cached ? toMap(cached) : new Map()
}

function computePeriod(satrec: SatRec): number {
    return ((2 * Math.PI) / satrec.no) * 60 * 1000
}

function computeTrace(satrec: SatRec, now: Date, periodMs: number): [number, number][] {
    const stepMs = periodMs / 360
    const halfPeriod = periodMs / 2
    const startMs = now.getTime() - halfPeriod
    const endMs = now.getTime() + halfPeriod

    const raw: [number, number][] = []
    for (let t = startMs; t <= endMs; t += stepMs) {
        const d = new Date(t)
        const gmst = gstime(d)
        const pos = propagate(satrec, d)?.position
        if (!pos || typeof pos === "boolean") continue
        const geo = eciToGeodetic(pos, gmst)
        raw.push([degreesLong(geo.longitude), degreesLat(geo.latitude)])
    }

    const points: [number, number][] = []
    let prevRawLon: number | null = null
    let prevLon = 0

    for (const pt of raw) {
        if (prevRawLon === null) {
            prevRawLon = pt[0]
            prevLon = pt[0]
            points.push([pt[0], pt[1]])
            continue
        }
        let delta = pt[0] - prevRawLon
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        prevLon += delta
        points.push([prevLon, pt[1]])
        prevRawLon = pt[0]
    }

    return points
}

export interface CategoryMeta {
    id: string
    label: string
    color: string
    count: number
}

export interface SatelliteController {
    categories: CategoryMeta[]
    deselect: () => void
    onSelect: (cb: (noradId: number | null) => void) => void
}

let selectedNoradId: number | null = null

export async function initSatellites(map: MaplibreMap): Promise<SatelliteController> {
    const { categories, satellites } = await loadSatellites()
    const ommData = await getOmmData([...new Set(satellites.map((s) => s.noradId))])

    const counts: Record<string, number> = {}
    const tracked: TrackedSatellite[] = []

    for (const s of satellites) {
        const omm = ommData.get(s.noradId)
        if (!omm) {
            console.warn(`[tracker] skipping ${s.name}, no OMM data`)
            continue
        }
        counts[s.category] = (counts[s.category] ?? 0) + 1
        tracked.push({ ...s, satrec: json2satrec(omm) })
    }

    map.addSource("sats", { type: "geojson", data: emptyFc() })
    map.addSource("sat-trace", { type: "geojson", data: emptyLineFc() })

    map.addImage(
        "square",
        {
            width: SQUARE_ICON_SIZE,
            height: SQUARE_ICON_SIZE,
            data: new Uint8Array(SQUARE_ICON_SIZE * SQUARE_ICON_SIZE * 4).fill(255)
        },
        { sdf: true }
    )

    map.addLayer({
        id: "sat-trace",
        type: "line",
        source: "sat-trace",
        paint: {
            "line-color": ["get", "color"],
            "line-width": 1.5,
            "line-opacity": 0.6,
            "line-dasharray": [2, 2]
        }
    })

    map.addLayer({
        id: "sats-glow",
        type: "symbol",
        source: "sats",
        filter: ["==", ["get", "selected"], true],
        layout: {
            "icon-image": "square",
            "icon-size": 2.5,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
        },
        paint: {
            "icon-color": ["get", "color"],
            "icon-opacity": 0.25
        }
    })

    map.addLayer({
        id: "sats",
        type: "symbol",
        source: "sats",
        layout: {
            "icon-image": "square",
            "icon-size": ["case", ["get", "selected"], 1.8, 1],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["get", "name"],
            "text-font": ["ShareTechMono"],
            "text-size": 16,
            "text-offset": [0.9, 0], // just right of the square
            "text-anchor": "left",
            "text-transform": "uppercase",
            "text-allow-overlap": true,
            "text-ignore-placement": true
        },
        paint: {
            "icon-color": ["get", "color"],
            "text-color": ["get", "color"], // match the square
            "text-halo-color": "#050805",
            "text-halo-width": 1
        }
    })

    // invisible, enlarged click target so satellites can be picked over land
    map.addLayer({
        id: "sats-hit",
        type: "circle",
        source: "sats",
        paint: {
            "circle-radius": SAT_HIT_RADIUS,
            "circle-opacity": 0
        }
    })

    const setTrace = (sat: TrackedSatellite | null) => {
        if (!sat) {
            ;(map.getSource("sat-trace") as GeoJSONSource).setData(emptyLineFc())
            return
        }
        const periodMs = computePeriod(sat.satrec)
        const coords = computeTrace(sat.satrec, new Date(), periodMs)
        ;(map.getSource("sat-trace") as GeoJSONSource).setData({
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: coords },
                    properties: { color: sat.color }
                }
            ]
        })
    }

    const tick = () => {
        const now = new Date()
        const gmst = gstime(now)

        const fc: FeatureCollection = {
            type: "FeatureCollection",
            features: tracked
                .map((s) => {
                    const position = propagate(s.satrec, now)?.position
                    if (!position || typeof position === "boolean") return null
                    const geo = eciToGeodetic(position, gmst)

                    return {
                        type: "Feature",
                        geometry: {
                            type: "Point",
                            coordinates: [degreesLong(geo.longitude), degreesLat(geo.latitude)]
                        },
                        properties: {
                            noradId: s.noradId,
                            name: s.name,
                            category: s.category,
                            altitude: geo.height,
                            color: s.color,
                            selected: s.noradId === selectedNoradId
                        }
                    } as GeoJsonFeature
                })
                .filter((f): f is GeoJsonFeature => f !== null)
        }

        ;(map.getSource("sats") as GeoJSONSource).setData(fc)
    }

    tick()
    setInterval(tick, 1000) // 1 Hz

    let selectCb: ((noradId: number | null) => void) | null = null

    const setSelection = (noradId: number | null) => {
        selectedNoradId = noradId
        setTrace(noradId === null ? null : (tracked.find((t) => t.noradId === noradId) ?? null))
        tick()
        selectCb?.(noradId)
    }

    map.on("mouseenter", "sats-hit", () => {
        map.getCanvas().style.cursor = "pointer"
    })
    map.on("mouseleave", "sats-hit", () => {
        map.getCanvas().style.cursor = ""
    })

    map.on("click", "sats-hit", (e) => {
        if (!e.features || e.features.length === 0) return
        const noradId = e.features[0]?.properties?.noradId as number
        setSelection(selectedNoradId === noradId ? null : noradId)
    })

    map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["sats-hit"] })
        if (features.length === 0 && selectedNoradId !== null) {
            setSelection(null)
        }
    })

    return {
        categories: categories.map((cat) => ({ ...cat, count: counts[cat.id] ?? 0 })),
        deselect: () => setSelection(null),
        onSelect: (cb) => {
            selectCb = cb
        }
    }
}
