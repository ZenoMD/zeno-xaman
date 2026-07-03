const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The xApp is entirely client-side and is deployed to Cloudflare Pages as a
  // static bundle, so export a plain static site (no Node server at runtime).
  output: "export",

  // The wallet init runs the Xaman sign-in exactly once; StrictMode's double
  // effect invocation in dev would fire two sign-in requests.
  reactStrictMode: false,

  webpack: (config, { webpack, isServer }) => {
    // Import .svg files as React components (via SVGR) so icons live in their
    // own .svg files instead of inline JSX. Next's built-in loader would treat
    // them as static-image URLs, so exclude .svg from it and hand them to SVGR.
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.(".svg"),
    );
    if (fileLoaderRule) fileLoaderRule.exclude = /\.svg$/i;
    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ["@svgr/webpack"],
    });

    // Swap @railgun-community/wallet's internal utils/gas-price.js (a hardcoded
    // network switch that throws "Undefined networkName" for our custom XRPL_EVM
    // network on broadcaster transactions) for our shim, which adds the XRPL_EVM
    // case. Scoped to the wallet package's own import so nothing else is touched.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /utils[\\/]gas-price(\.js)?$/,
        (resource) => {
          const from = (resource.context || "").replace(/\\/g, "/");
          if (from.includes("@railgun-community/wallet/dist")) {
            resource.request = path.resolve(
              __dirname,
              "lib/railgun-gas-price-shim.ts",
            );
          }
        },
      ),
    );

    // Swap @railgun-community/wallet's internal quick-sync dispatcher
    // (quick-sync/quick-sync-events.js) — whose `quickSyncEventsGraph` the engine
    // calls to bulk-fetch shielded history — for our shim, which serves that from
    // our Goldsky-hosted RAILGUN V2 subgraph for XRPL EVM instead of throwing
    // "No Graph API hosted service" and falling back to the slow per-499-block
    // getLogs scan. The regex matches only the dispatcher, not the sibling
    // quick-sync-events-graph-v2/v3.js. Scoped to the wallet package's import.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /quick-sync[\\/]quick-sync-events(\.js)?$/,
        (resource) => {
          const from = (resource.context || "").replace(/\\/g, "/");
          if (from.includes("@railgun-community/wallet/dist")) {
            resource.request = path.resolve(
              __dirname,
              "lib/railgun-quicksync-shim.ts",
            );
          }
        },
      ),
    );

    // RAILGUN + snarkjs were written for Node, so polyfill the core modules they
    // reach for when bundled into the browser/worker (Parcel did this implicitly).
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        assert: require.resolve("assert"),
        buffer: require.resolve("buffer"),
        constants: require.resolve("constants-browserify"),
        crypto: require.resolve("crypto-browserify"),
        http: require.resolve("stream-http"),
        https: require.resolve("https-browserify"),
        stream: require.resolve("stream-browserify"),
        url: require.resolve("url"),
        vm: require.resolve("vm-browserify"),
        zlib: require.resolve("browserify-zlib"),
        fs: false,
        path: false,
        os: false,
      };

      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: "process/browser",
        }),
      );
    }

    // RAILGUN's POI/subgraph layer pulls in @graphql-tools/url-loader, which uses
    // dynamic require() expressions webpack can't statically resolve. They're not
    // hit on the shielded-balance path, so downgrade the "Critical dependency"
    // error to a non-blocking warning instead of failing the build/dev overlay.
    config.module.exprContextCritical = false;
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
};

module.exports = nextConfig;
