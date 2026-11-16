import { defineConfig } from 'vitepress'

const repo = 'https://github.com/abubakarsiddik31/portolan'

export default defineConfig({
  title: 'Portolan',
  titleTemplate: ':title · Portolan',
  description: 'Chart the web once. Every agent sails it. An API layer for websites that runs on a browser.',
  base: '/portolan/',
  cleanUrls: false,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/portolan/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0E3B33' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Portolan' }],
    ['meta', { property: 'og:description', content: 'Chart the web once. Every agent sails it.' }],
    ['meta', { property: 'og:image', content: 'https://abubakarsiddik31.github.io/portolan/logo.svg' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Portolan',
    nav: [
      { text: 'Guide', link: '/guide/what-is-portolan', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/mcp-tools', activeMatch: '/reference/' },
      { text: 'Project', link: '/project/vision', activeMatch: '/project/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'What is Portolan?', link: '/guide/what-is-portolan' },
            { text: 'Quickstart', link: '/guide/quickstart' },
            { text: 'Connect your agent', link: '/guide/clients' },
          ],
        },
        {
          text: 'Using Portolan',
          items: [
            { text: 'Concepts', link: '/guide/concepts' },
            { text: 'Using maps', link: '/guide/using-maps' },
            { text: 'Write safety', link: '/guide/write-safety' },
            { text: 'Skills', link: '/guide/skills' },
          ],
        },
        {
          text: 'Building maps',
          items: [{ text: 'Build a map', link: '/guide/compiling-maps' }],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'MCP tools', link: '/reference/mcp-tools' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Map format v0', link: '/reference/map-format' },
          ],
        },
      ],
      '/project/': [
        {
          text: 'Project',
          items: [
            { text: 'Vision', link: '/project/vision' },
            { text: 'Architecture', link: '/project/architecture' },
            { text: 'Security', link: '/project/security' },
            { text: 'Benchmark', link: '/project/benchmark' },
            { text: 'Licensing', link: '/project/licensing' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: {
      pattern: `${repo}/edit/main/website/:path`,
      text: 'Edit this page on GitHub',
    },
    lastUpdated: {
      text: 'Last updated',
    },
    outline: { level: [2, 3], label: 'On this page' },
    footer: {
      message: 'Released under Apache-2.0 · MIT · CC-BY-4.0',
      copyright: 'Portolan',
    },
  },
})
