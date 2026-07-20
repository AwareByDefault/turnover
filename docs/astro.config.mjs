// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Turnover',
			description:
				'Decorator-first REST framework for Bun — inject your dependencies, mount controllers, and let them rest.',
			logo: { src: './src/assets/turnover.svg', alt: 'Turnover' },
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/AwareByDefault/turnover',
				},
			],
			editLink: {
				baseUrl:
					'https://github.com/AwareByDefault/turnover/edit/main/docs/',
			},
			lastUpdated: true,
			// Sidebar groups are populated from the directory structure; per-page
			// order is controlled by each page's `sidebar.order` frontmatter.
			sidebar: [
				{ label: 'Getting Started', items: [{ autogenerate: { directory: 'getting-started' } }] },
				{ label: 'Core Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
				{ label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
				{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
			],
		}),
	],
});
