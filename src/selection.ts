import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl"
import { SELECTION } from "./const"

export interface CountrySelection {
    name: string
    isoA2: string | null
    geometry: CountryGeometry
}

export interface CountryController {
    deselect: () => void
    onSelect: (cb: (sel: CountrySelection | null) => void) => void
    getSelection: () => CountrySelection | null
}

interface CountryGeometry {
    type: "Polygon" | "MultiPolygon"
    coordinates: unknown[]
}

interface CountryFeature {
    type: "Feature"
    properties: Record<string, unknown>
    geometry: CountryGeometry
}

interface CountriesGeoJson {
    type: "FeatureCollection"
    features: CountryFeature[]
}

const emptyFc = (): CountriesGeoJson => ({ type: "FeatureCollection", features: [] })

export async function initCountrySelection(map: MaplibreMap): Promise<CountryController> {
    const data: CountriesGeoJson = await (
        await fetch("/data/ne_110m_admin_0_countries.geojson")
    ).json()

    // full (unclipped, unsimplified) geometry indexed by NE_ID
    const byNeId = new Map<unknown, CountryGeometry>()
    for (const f of data.features) byNeId.set(f.properties.NE_ID, f.geometry)

    let selected: CountrySelection | null = null
    let selectCb: ((sel: CountrySelection | null) => void) | null = null

    map.addSource("countries", { type: "geojson", data })
    map.addSource("selected-country", { type: "geojson", data: emptyFc() })

    map.addLayer(
        {
            id: "countries",
            type: "fill",
            source: "countries",
            paint: { "fill-color": SELECTION, "fill-opacity": 0 }
        },
        "sat-trace"
    )

    map.addLayer(
        {
            id: "selected-country",
            type: "fill",
            source: "selected-country",
            paint: { "fill-color": SELECTION, "fill-opacity": 0.2 }
        },
        "sat-trace"
    )

    map.addLayer(
        {
            id: "selected-country-outline",
            type: "line",
            source: "selected-country",
            paint: { "line-color": SELECTION, "line-width": 1, "line-opacity": 0.9 }
        },
        "sat-trace"
    )

    const setSelection = (sel: CountrySelection | null) => {
        selected = sel
        const fc: CountriesGeoJson = sel
            ? {
                  type: "FeatureCollection",
                  features: [
                      { type: "Feature", geometry: sel.geometry, properties: {} } as CountryFeature
                  ]
              }
            : emptyFc()
        ;(map.getSource("selected-country") as GeoJSONSource).setData(fc)
        selectCb?.(sel)
    }

    map.on("mouseenter", "countries", () => {
        map.getCanvas().style.cursor = "pointer"
    })
    map.on("mouseleave", "countries", () => {
        map.getCanvas().style.cursor = ""
    })

    map.on("click", "countries", (e) => {
        if (!e.features || e.features.length === 0) return
        // satellites always win the click, even over land
        if (map.queryRenderedFeatures(e.point, { layers: ["sats-hit"] }).length > 0) return
        const f = e.features[0] as unknown as CountryFeature
        const name = (f.properties.NAME as string) ?? (f.properties.ADMIN as string) ?? "Unknown"
        const isoRaw = f.properties.ISO_A2 as string | null | undefined
        const isoA2 = !isoRaw || isoRaw === "-99" ? null : isoRaw
        const geometry =
            (f.properties.NE_ID !== undefined ? byNeId.get(f.properties.NE_ID) : undefined) ??
            f.geometry
        setSelection(selected?.name === name ? null : { name, isoA2, geometry })
    })

    map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["countries"] })
        if (features.length === 0 && selected !== null) {
            setSelection(null)
        }
    })

    return {
        deselect: () => setSelection(null),
        onSelect: (cb) => {
            selectCb = cb
        },
        getSelection: () => selected
    }
}
