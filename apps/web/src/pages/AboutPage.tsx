import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import { GAME_MODE_INFO } from '../data/gameModes';

export default function AboutPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <main className="about-shell">
      <header className="about-hero">
        <a className="starter-brand" href="/" aria-label="Words of Word home">words <i>of</i> word</a>
        <div className="about-hero__grid">
          <section>
            <p className="starter-kicker">all modes · videos · setup</p>
            <h1>Every way to play Words of Word.</h1>
            <p>
              Start from one big source word, then race to discover smaller valid words hidden inside it. Play online,
              create a private room, or jump into the Daily Word challenge at wordsofword.in.
            </p>
            <div className="about-actions">
              <Button variant="primary" onClick={() => navigate('/')}>Play now →</Button>
              <Button variant="secondary" onClick={() => navigate('/settings')}>Create room</Button>
            </div>
          </section>
          <video
            className="about-hero__video"
            src="/marketing/website-hero-gameplay-video.mp4"
            poster="/marketing/website-hero-gameplay-preview.png"
            muted
            autoPlay
            loop
            playsInline
            controls
          />
        </div>
      </header>

      <section className="about-setup" aria-labelledby="setup-title">
        <p className="starter-kicker">quick setup</p>
        <h2 id="setup-title">How to set up a game</h2>
        <ol>
          <li><b>Enter your player name</b> and customize your avatar.</li>
          <li><b>Online Multiplayer</b> finds public rooms, or choose <b>Create Private Room</b> for a shareable code.</li>
          <li><b>Pick a mode</b>, player limit, source-word length, rounds, and timer.</li>
          <li><b>Share the join link</b>; once players arrive, the host starts the battle.</li>
        </ol>
      </section>

      <section className="about-modes" aria-labelledby="modes-title">
        <p className="starter-kicker">mode guide</p>
        <h2 id="modes-title">All game modes</h2>
        <div className="about-mode-grid">
          {GAME_MODE_INFO.map((mode) => (
            <article className="about-mode-card" key={mode.value}>
              {mode.videoSrc ? (
                <video src={mode.videoSrc} poster={mode.posterSrc} muted loop playsInline preload="metadata" controls />
              ) : mode.posterSrc ? (
                <img src={mode.posterSrc} alt="" loading="lazy" />
              ) : null}
              <div>
                <p>{mode.tagline}</p>
                <h3>{mode.label}</h3>
                <span>{mode.description}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
