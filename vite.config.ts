import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Preset de deploy do Nitro. Na Vercel é auto-detectado (env VERCEL); pode ser
// forçado por SERVER_PRESET/NITRO_PRESET (ex.: "vercel", "node-server").
const preset = process.env.SERVER_PRESET ?? process.env.NITRO_PRESET;

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    // Redireciona a entrada de servidor do TanStack Start para src/server.ts
    // (wrapper de erro de SSR + endpoint /api/cron).
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // Nitro por último (build). Gera .vercel/output no preset "vercel".
    nitro(preset ? { preset } : {}),
  ],
});
