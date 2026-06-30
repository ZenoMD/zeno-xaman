/** @type {import('next').NextConfig} */
const nextConfig = {
  // The xApp is entirely client-side and is deployed to Cloudflare Pages as a
  // static bundle, so export a plain static site (no Node server at runtime).
  output: "export",

  // The wallet init runs the Xaman sign-in exactly once; StrictMode's double
  // effect invocation in dev would fire two sign-in requests.
  reactStrictMode: false,

  webpack: (config, { webpack, isServer }) => {
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
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];

    return config;
  },
};

module.exports = nextConfig;
