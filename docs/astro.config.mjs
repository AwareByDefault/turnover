// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// https://astro.build/config
export default defineConfig({
	// TODO: set to the real docs domain once chosen. Used for canonical URLs, the
	// sitemap, and the absolute links in llms.txt / llms-full.txt.
	site: 'https://turnover.awarebydefault.com',
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
			// Emits /llms.txt (a structured index) and /llms-full.txt (the whole
			// site as one Markdown file) for LLM consumption.
			plugins: [
				starlightLlmsTxt({
					projectName: 'Turnover',
					description:
						'Decorator-first REST framework for Bun — `@controller`/`@get` routing, a tiny dependency-injection container, guards, Standard-Schema validation, and more on top of `Bun.serve`.',
				}),
			],
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
