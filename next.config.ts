import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/admin/price-lookup": [
      "./node_modules/playwright-core/.local-browsers/**",
      "./node_modules/playwright/.local-browsers/**",
    ],
    "/api/admin/price-lookup/vendor-credentials/test": [
      "./node_modules/playwright-core/.local-browsers/**",
      "./node_modules/playwright/.local-browsers/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
