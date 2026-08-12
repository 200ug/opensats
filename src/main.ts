import { Map as MaplibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { initSatellites } from "./tracker"
import { initCategoryPanel } from "./ui/categories"
import { initCountrySelection } from "./selection"
import { OCEAN, LAND, BORDER } from "./const"

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
    const satellites = await initSatellites(map)
    initCategoryPanel(map, satellites.categories)

    const countries = await initCountrySelection(map)

    satellites.onSelect((noradId) => {
        if (noradId !== null) countries.deselect()
    })
    countries.onSelect((sel) => {
        if (sel !== null) satellites.deselect()
    })
})
