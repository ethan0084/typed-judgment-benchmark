/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep provider SDKs server-side only; they must never enter a browser bundle.
  serverExternalPackages: ["@typesafe-ai/sdk", "xlsx"],
};

export default nextConfig;
