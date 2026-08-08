import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
    plugins: [tailwindcss()],
    optimizeDeps: {
        // maplibre loads its worker as a sibling file, pre-bundling breaks that relative path
        exclude: ["maplibre-gl"]
    }
})
