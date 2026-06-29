import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "tree-sitter",
    "tree-sitter-typescript",
    "tree-sitter-python",
    "tree-sitter-javascript",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Native bindings must not be bundled. tree-sitter and friends
      // ship per-platform prebuilds and load them at runtime via
      // platform detection. Webpack can't tree-shake these.
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals]),
        (request: { request?: string }, callback: (err?: Error | null, result?: string) => void) => {
          if (request?.request?.endsWith(".node")) {
            return callback(null, "commonjs " + request.request);
          }
          return callback();
        },
      ];
    }
    return config;
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default config;