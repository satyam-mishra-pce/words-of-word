import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_LOCAL_SERVER_URL?.trim() || 'http://localhost:4000';
  const httpProxy: ProxyOptions = {
    target: backendTarget,
    changeOrigin: true,
  };

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/socket.io': { ...httpProxy, ws: true },
        '/api': httpProxy,
      },
    },
    preview: {
      port: 3000,
      proxy: {
        '/socket.io': { ...httpProxy, ws: true },
        '/api': httpProxy,
      },
    },
  };
});
