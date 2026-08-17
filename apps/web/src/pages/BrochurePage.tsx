import { useState } from 'react';
import { Alert } from '../components/ui';
import { GAME_MODE_INFO } from '../data/gameModes';

const FLOAT_CHARS = ['W', 'O', 'R', 'D', 'S', '?'];

const waysToPlay = [
  {
    title: 'Multiplayer',
    copy: 'Create a room, choose your rules, share the room code, and battle friends in real time.',
  },
  {
    title: 'Daily Word',
    copy: 'A shared daily challenge where everyone gets the same word and can compare results.',
  },
];

const gameModes = GAME_MODE_INFO;

const screenshots = [
  { src: '/media/gameplay.png', alt: 'Words of Word gameplay screen' },
  { src: '/media/final-standings.png', alt: 'Final standings screen' },
  { src: '/media/game-settings.png', alt: 'Game settings screen' },
  { src: '/media/daily-word-preview.png', alt: 'Daily Word preview' },
];

export default function BrochurePage(): JSX.Element {
  const [lightboxIndex, setLightboxIndex] = useState<number | undefined>();
  const [copyNotice, setCopyNotice] = useState('');
  const activeScreenshot = lightboxIndex === undefined ? undefined : screenshots[lightboxIndex];

  function showPrevious(): void {
    setLightboxIndex((current) => current === undefined ? 0 : (current + screenshots.length - 1) % screenshots.length);
  }

  function showNext(): void {
    setLightboxIndex((current) => current === undefined ? 0 : (current + 1) % screenshots.length);
  }

  async function copyShareLink(): Promise<void> {
    await navigator.clipboard?.writeText(window.location.href);
    setCopyNotice('Link copied.');
    window.setTimeout(() => setCopyNotice(''), 1800);
  }

  return (
    <main className="site-shell">
      <div className="float-letters" aria-hidden="true">
        {FLOAT_CHARS.map((char) => (
          <span key={char} className="float-letter">{char}</span>
        ))}
      </div>

      <nav className="site-nav" aria-label="Main navigation">
        <a className="brand-mark" href="#top">words<span>of</span>word</a>
        <div className="site-nav__links">
          <a href="#ways">ways</a>
          <a href="#modes">modes</a>
          <a href="#media">media</a>
          <a href="#press">press</a>
          <a href="#creator">creator</a>
        </div>
      </nav>

      <section id="top" className="portfolio-hero">
        <div className="portfolio-hero__copy">
          <p className="eyebrow">word battle · real-time · daily challenge</p>
          <h1>Words of Word</h1>
          <p className="hero-copy">
            A fast multiplayer word game where everyone races to find hidden words inside one big source word.
          </p>
          <div className="hero-live-card">
            <span>live playable build</span>
            <strong>Play in browser — no install needed.</strong>
          </div>
          <div className="hero-actions">
            <a className="ui-btn ui-btn-secondary ui-btn-lg" href="#media">Watch trailer</a>
            <button className="ui-btn ui-btn-ghost ui-btn-lg" type="button" onClick={copyShareLink}>Share</button>
          </div>
          {copyNotice && <Alert variant="success" style={{ marginTop: 14, maxWidth: 220 }}>{copyNotice}</Alert>}
        </div>

        <div className="hero-media-card">
          <video controls playsInline poster="/media/website-hero-preview.png">
            <source src="/media/trailer.mp4" type="video/mp4" />
          </video>
          <p>official gameplay trailer</p>
        </div>
      </section>

      <section className="section-grid two-col">
        <article className="site-card">
          <span className="eyebrow">the idea</span>
          <h2>What is the game?</h2>
          <p>
            Words of Word gives every player the same source word. Your goal is to find as many valid words hidden inside it as possible before time runs out. Short words are safe. Long words are risky. Smart words win.
          </p>
        </article>
        <article className="site-card accent-card">
          <span className="eyebrow">why it works</span>
          <h2>Simple to start, hard to master.</h2>
          <p>
            It feels casual in the first few seconds, then becomes a battle of speed, vocabulary, memory, and pressure as the leaderboard changes in real time.
          </p>
        </article>
      </section>

      <section id="how" className="site-section">
        <span className="eyebrow">how to play</span>
        <h2>Three steps. The clock starts ticking.</h2>
        <div className="steps-grid">
          <div><strong>01</strong><h3>Read the source word</h3><p>Everyone receives the same big word at the start of the round.</p></div>
          <div><strong>02</strong><h3>Type hidden words</h3><p>Submit real words using only letters from the source word.</p></div>
          <div><strong>03</strong><h3>Climb the scoreboard</h3><p>Score with quantity, speed, and longer discoveries before time runs out.</p></div>
        </div>
      </section>

      <section id="ways" className="site-section">
        <span className="eyebrow">ways to play</span>
        <h2>Play with friends or take the daily challenge</h2>
        <div className="modes-grid modes-grid--two">
          {waysToPlay.map((mode) => (
            <article className="site-card" key={mode.title}>
              <h3>{mode.title}</h3>
              <p>{mode.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="modes" className="site-section">
        <span className="eyebrow">modes</span>
        <h2>All modes for different kinds of chaos</h2>
        <div className="modes-grid modes-grid--seven">
          {gameModes.map((mode) => (
            <article className="site-card mode-card" key={mode.value}>
              {mode.videoSrc && (
                <video className="mode-card__video" controls muted playsInline preload="metadata" poster={mode.posterSrc}>
                  <source src={mode.videoSrc} type="video/mp4" />
                </video>
              )}
              <h3>{mode.label}</h3>
              <p>{mode.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="media" className="site-section">
        <span className="eyebrow">media</span>
        <h2>Screenshots, clips, and stream material</h2>
        <div className="media-grid">
          {screenshots.map((shot, index) => (
            <button className="media-thumb" type="button" key={shot.src} onClick={() => setLightboxIndex(index)}>
              <img src={shot.src} alt={shot.alt} />
            </button>
          ))}
        </div>
      </section>

      <section id="press" className="press-panel">
        <div>
          <span className="eyebrow">press kit</span>
          <h2>For streamers, creators, and coverage</h2>
          <p className="muted">Use this page as the official source for the game description, screenshots, trailer, logo, and creator links.</p>
        </div>
        <dl className="fact-sheet">
          <div><dt>Game</dt><dd>Words of Word</dd></div>
          <div><dt>Genre</dt><dd>Multiplayer word / typing battle</dd></div>
          <div><dt>Platform</dt><dd>Web browser</dd></div>
          <div><dt>Status</dt><dd>Playable build</dd></div>
          <div><dt>Best for</dt><dd>Friends, stream challenges, daily scores</dd></div>
        </dl>
      </section>

      <section id="creator" className="creator-panel">
        <div>
          <span className="eyebrow">about the creator</span>
          <h2>Built by Harshit Sharma</h2>
          <p>
            I am building Words of Word as a clean, competitive, shareable word game that people can play casually with friends or turn into a high-score challenge on stream.
          </p>
        </div>
      </section>

      {activeScreenshot && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot preview" onClick={() => setLightboxIndex(undefined)}>
          <button className="lightbox__close" type="button" onClick={() => setLightboxIndex(undefined)} aria-label="Close preview">×</button>
          <button className="lightbox__nav lightbox__nav--prev" type="button" onClick={(event) => { event.stopPropagation(); showPrevious(); }} aria-label="Previous screenshot">‹</button>
          <img src={activeScreenshot.src} alt={activeScreenshot.alt} onClick={(event) => event.stopPropagation()} />
          <button className="lightbox__nav lightbox__nav--next" type="button" onClick={(event) => { event.stopPropagation(); showNext(); }} aria-label="Next screenshot">›</button>
        </div>
      )}
    </main>
  );
}
