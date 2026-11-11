import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The mocks answer exactly the paths a real SIS does; no added or removed slashes.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
