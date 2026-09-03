import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude WASM/CSL packages from SSR — they are browser-only
  // Without this, Next.js tries to load browser .wasm files in Node.js (SSR) and crashes
  serverExternalPackages: [
    "@sidan-lab/sidan-csl-rs-browser",
    "@sidan-lab/sidan-csl-rs-nodejs",
    "@meshsdk/core-csl",
  ],

  webpack: function (config, { isServer }) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    if (isServer) {
      config.output.webassemblyModuleFilename = "./../static/wasm/[modulehash].wasm";
    } else {
      config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    }
    return config;
  },
};

export default nextConfig;

