import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "./"),
  transpilePackages: ["@meshsdk/core", "@meshsdk/react", "@meshsdk/web3-sdk"],
  webpack: function (config, { webpack }: any) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: any) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    return config;
  },
};

export default nextConfig;
