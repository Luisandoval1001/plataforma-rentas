import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Habilita forbidden() en requireRol.
    authInterrupts: true,
    // Archivos de hasta 4 MB (src/lib/validators/archivo.ts) + margen del multipart. Vercel no acepta
    // cuerpos de más de ~4.5 MB en funciones: subir más no serviría en producción.
    serverActions: { bodySizeLimit: '4.5mb' },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
