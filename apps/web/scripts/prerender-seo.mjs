#!/usr/bin/env node
/**
 * Prerender-lite / SSG for the SPA.
 *
 * Why this exists: the app is client-rendered and Vercel rewrites every route
 * to index.html. Crawlers and link unfurlers that don't run JS would otherwise
 * see a single generic page. This script clones the built dist/index.html and
 * writes a route-specific static HTML file per marketing route with its own
 * <title>, description, canonical, Open Graph/Twitter tags, and a crawlable
 * content block inside #root. React (createRoot) replaces that block on the
 * client, so users still get the full SPA — this only upgrades what bots read.
 *
 * Vercel serves files from the output directory BEFORE applying the SPA
 * catch-all rewrite, so dist/about/index.html is returned for /about.
 *
 * Runs automatically after `vite build` (see package.json build script).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const templatePath = join(distDir, 'index.html');

const ORIGIN = 'https://wordsofword.in';

/** @type {{path:string,title:string,description:string,h1:string,intro:string,links:[string,string][]}[]} */
const routes = [
  {
    path: '/about',
    title: 'About Words of Word — All 18 Game Modes Explained',
    description:
      'Learn how to play Words of Word and every game mode: Classic, Score Attack, Precision, Teams, Betting, Word Sprint, Knockout, Blind Type, Theme, Claim, Busted, Common Word, Intuition, Lightning, Bingo, Mix, and Daily Word.',
    h1: 'Every way to play Words of Word.',
    intro:
      'Words of Word is a free real-time multiplayer word battle. This guide covers how to set up a game and explains all 18 modes — from Classic and Score Attack to Teams, Betting, Knockout, and the solo Daily Word challenge.',
    links: [
      ['/', 'Play now'],
      ['/daily', 'Daily Word challenge'],
      ['/online', 'Play online with friends'],
    ],
  },
  {
    path: '/daily',
    title: 'Daily Word Challenge — Words of Word',
    description:
      'Take on the Words of Word daily challenge: one shared source word each day, race the clock to spell as many hidden words as you can, and compare your run. Free, no sign-up, play in your browser.',
    h1: 'Words of Word — Daily Word Challenge',
    intro:
      'A fresh source word every day. Spell as many valid hidden words as you can before the timer runs out, then see how your run stacks up. No sign-up required — play free in your browser.',
    links: [
      ['/', 'Play multiplayer'],
      ['/online', 'Play online with friends'],
      ['/about', 'How to play'],
    ],
  },
  {
    path: '/online',
    title: 'Play Online Multiplayer Word Battle — Words of Word',
    description:
      'Jump into public online matchmaking or create a private room in Words of Word. Real-time multiplayer word battles with friends across 18 modes. Free, no download, play in your browser.',
    h1: 'Words of Word — Online Multiplayer',
    intro:
      'Join a public match instantly or spin up a private room and invite friends. Real-time multiplayer word battles across 18 modes, straight in your browser — no download, no sign-up.',
    links: [
      ['/', 'Play now'],
      ['/daily', 'Daily Word challenge'],
      ['/about', 'How to play'],
    ],
  },
  {
    path: '/social',
    title: 'Follow Words of Word — X, Instagram, YouTube & Discord',
    description:
      'Follow Words of Word across X (Twitter), Instagram, YouTube, and Discord for puzzles, updates, and behind-the-words moments. Play the game free in your browser.',
    h1: 'Follow the word',
    intro:
      'Join the Words of Word community on X, Instagram, YouTube, and Discord — puzzles, updates, and behind-the-words moments. Play the game free, no sign-up, in your browser.',
    links: [
      ['/', 'Play now'],
      ['/daily', 'Daily Word challenge'],
      ['/online', 'Play online with friends'],
    ],
  },
];

let template;
try {
  template = readFileSync(templatePath, 'utf8');
} catch {
  console.error(`[prerender-seo] dist/index.html not found — did vite build run? (${templatePath})`);
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildBootBlock(route) {
  const nav = route.links.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('\n          ');
  return `<main class="app-boot" role="status" aria-label="Opening Words of Word">
        <h1>${esc(route.h1)}</h1>
        <p>${esc(route.intro)}</p>
        <nav aria-label="Primary">
          ${nav}
        </nav>
        <span class="app-boot-brand" aria-hidden="true">
          <span>word battle</span>
          <strong>W.o.W</strong>
          <i></i>
        </span>
      </main>`;
}

function renderRoute(route) {
  const url = `${ORIGIN}${route.path}`;
  let html = template;

  // <title>
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(route.title)}</title>`);

  // name="description"
  html = html.replace(
    /(<meta name="description" content=")[\s\S]*?(" \/>)/,
    `$1${esc(route.description)}$2`,
  );

  // canonical
  html = html.replace(
    /(<link rel="canonical" href=")[^"]*(" \/>)/,
    `$1${url}$2`,
  );

  // og:url
  html = html.replace(
    /(<meta property="og:url" content=")[^"]*(" \/>)/,
    `$1${url}$2`,
  );
  // og:title
  html = html.replace(
    /(<meta property="og:title" content=")[\s\S]*?(" \/>)/,
    `$1${esc(route.title)}$2`,
  );
  // og:description
  html = html.replace(
    /(<meta property="og:description" content=")[\s\S]*?(" \/>)/,
    `$1${esc(route.description)}$2`,
  );
  // twitter:title
  html = html.replace(
    /(<meta name="twitter:title" content=")[\s\S]*?(" \/>)/,
    `$1${esc(route.title)}$2`,
  );
  // twitter:description
  html = html.replace(
    /(<meta name="twitter:description" content=")[\s\S]*?(" \/>)/,
    `$1${esc(route.description)}$2`,
  );

  // crawlable #root content
  html = html.replace(/<main class="app-boot"[\s\S]*?<\/main>/, buildBootBlock(route));

  const outDir = join(distDir, route.path.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  return `${route.path} -> dist${route.path}/index.html`;
}

const written = routes.map(renderRoute);
console.log(`[prerender-seo] wrote ${written.length} route pages:\n  ${written.join('\n  ')}`);
