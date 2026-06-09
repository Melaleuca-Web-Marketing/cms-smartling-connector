const backendTarget = process.env.BACKEND_TARGET || "http://127.0.0.1:17817";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/cms-smartling",
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/custom-jobs.html",
        destination: "/custom-jobs",
        permanent: false
      },
      {
        source: "/recent-jobs.html",
        destination: "/recent-jobs",
        permanent: false
      }
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendTarget}/api/:path*`
      },
      {
        source: "/health",
        destination: `${backendTarget}/health`
      }
    ];
  }
};

export default nextConfig;
