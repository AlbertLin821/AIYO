/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    if (String(process.env.NEXT_PUBLIC_PHASE_C_READONLY || "false").toLowerCase() !== "true") {
      return [];
    }
    return [
      { source: "/", destination: "/v2", permanent: false },
      { source: "/home", destination: "/legacy", permanent: false }
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/**" },
      { protocol: "https", hostname: "i9.ytimg.com", pathname: "/**" },
      { protocol: "https", hostname: "img.youtube.com", pathname: "/**" },
      { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/**" },
      { protocol: "https", hostname: "avatars.githubusercontent.com", pathname: "/**" }
    ]
  }
};

export default nextConfig;
