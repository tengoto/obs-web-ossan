import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export const viteConfig = {
  plugins: [],
}

const config = {
  preprocess: vitePreprocess(),

  kit: {
    paths: {
      base: '/obs-web-ossan'
    },

    adapter: adapter({
      pages: 'public',
      assets: 'public',
      fallback: 'index.html'
    }),

    output: {
      bundleStrategy: 'single'
    }
  }
}

export default config
