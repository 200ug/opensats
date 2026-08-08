import { Map as MaplibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { initSatellites } from "./tracker"
import { initCategoryPanel } from "./ui/categories"
import { OCEAN, LAND, BORDER, CATEGORIES, PALETTE } from "./const"

const map = new MaplibreMap({
    container: "map",
    pixelRatio: 1,
    attributionControl: false,
    style: {
        version: 8,
        sources: {
            land: { type: "geojson", data: "/data/ne_110m_land.geojson" },
            borders: { type: "geojson", data: "/data/ne_110m_admin_0_boundary_lines_land.geojson" }
        },
        layers: [
            {
                id: "ocean",
                type: "background",
                paint: { "background-color": OCEAN }
            },
            {
                id: "land",
                type: "fill",
                source: "land",
                paint: { "fill-color": LAND }
            },
            {
                id: "borders",
                type: "line",
                source: "borders",
                paint: { "line-color": BORDER, "line-width": 1 }
            }
        ]
    },
    center: [0, 20],
    zoom: 2
})

map.on("load", async () => {
    await initSatellites(map)
    initCategoryPanel(
        map,
        CATEGORIES.map((id) => ({ id, label: id, color: PALETTE[id]! }))
    )
})
