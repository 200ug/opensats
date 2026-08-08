import type { FilterSpecification, Map as MaplibreMap } from "maplibre-gl"

export interface CategoryMeta {
    id: string
    label: string
    color: string
}

export function initCategoryPanel(map: MaplibreMap, categories: CategoryMeta[]) {
    const panel = document.createElement("div")
    panel.className = "absolute top-4 left-4 z-10 flex flex-col gap-2"

    const enabled = new Set(categories.map((c) => c.id))
    const updateFilter = () => {
        map.setFilter("sats", [
            "in",
            ["get", "category"],
            ["literal", Array.from(enabled)]
        ] as unknown as FilterSpecification)
    }

    for (const cat of categories) {
        const label = document.createElement("label")
        label.className =
            "flex cursor-pointer items-center gap-2 font-retro text-ms uppercase tracking-wider text-border"

        const cb = document.createElement("input")
        cb.type = "checkbox"
        cb.checked = true
        cb.addEventListener("change", () => {
            if (cb.checked) enabled.add(cat.id)
            else enabled.delete(cat.id)
            updateFilter()
        })

        const swatch = document.createElement("span")
        swatch.className = "inline-block h-3 w-3 border border-border"
        swatch.style.backgroundColor = cat.color

        label.append(cb, swatch, document.createTextNode(cat.label))
        panel.append(label)
    }

    document.getElementById("app")!.append(panel)
    updateFilter()
}
