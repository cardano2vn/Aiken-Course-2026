import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: function (config, { isServer }) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    if (isServer) {
      config.output.webassemblyModuleFilename = './../static/wasm/[modulehash].wasm';
    } else {
      config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    }
    return config;
  },
};

export default nextConfig;
