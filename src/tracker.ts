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
import { CELESTRAK_FETCH_DELAY_MS, OMM_CACHE_KEY, OMM_CACHE_TTL, SQUARE_ICON_SIZE } from "./const"

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
    categories: CategoryMeta[]
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

interface OmmCache {
    fetchedAt: number
    sats: {
        noradId: number
        omm: OMMJsonObject
    }[]
}

const emptyFc = (): FeatureCollection => ({ type: "FeatureCollection", features: [] })
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

export interface CategoryMeta {
    id: string
    label: string
    color: string
    count?: number
}

export async function initSatellites(map: MaplibreMap): Promise<CategoryMeta[]> {
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
        id: "sats",
        type: "symbol",
        source: "sats",
        layout: {
            "icon-image": "square",
            "icon-size": 1,
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
                            name: s.name,
                            category: s.category,
                            altitude: geo.height,
                            color: s.color
                        }
                    } as GeoJsonFeature
                })
                .filter((f): f is GeoJsonFeature => f !== null)
        }

        ;(map.getSource("sats") as GeoJSONSource).setData(fc)
    }

    tick()
    setInterval(tick, 1000) // 1 Hz

    return categories.map((cat) => ({ ...cat, count: counts[cat.id] ?? 0 }))
}
