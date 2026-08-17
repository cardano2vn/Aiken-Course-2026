/** @type {import('next').NextConfig} */
import path from "path";

const nextConfig = {
  transpilePackages: ['@secret-number/offchain'],
  reactStrictMode: true,
  turbopack: {
    // Workspace root (contains both `frontend` and `offchain`) to avoid
    // Next.js "inferred root / multiple lockfiles" warnings.
    root: path.join(__dirname, ".."),
    rules: {
      "*.wasm": {
        loaders: ["file-loader"],
        as: "*.wasm",
      },
    },
  },
  webpack: function (config: any, _options: any) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
};

export default nextConfig;
