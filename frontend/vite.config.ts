import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: [],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunk for core React libraries
          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("react-router-dom")
          ) {
            return "vendor";
          }
          // Chart.js chunk
          if (id.includes("chart.js") || id.includes("react-chartjs-2")) {
            return "chartjs";
          }
          // Recharts chunk
          if (id.includes("recharts")) {
            return "recharts";
          }
          // Utilities chunk
          if (id.includes("axios") || id.includes("socket.io-client")) {
            return "utils";
          }
          // Machine learning chunk
          if (id.includes("@tensorflow/tfjs")) {
            return "ml";
          }
          // Crypto chunk
          if (id.includes("crypto-js")) {
            return "crypto";
          }
          // UI chunk - only include if modules are actually used
          if (id.includes("tailwind-merge") || id.includes("lucide-react")) {
            return "ui";
          }
          return null;
        },
      },
    },
    chunkSizeWarningLimit: 500,
    sourcemap: true,
  },
  base: "/",
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "5173"),
  },
  preview: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "5173"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
