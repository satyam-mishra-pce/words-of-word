import { useNavigate } from 'react-router-dom';
import { Button, Tooltip } from '../components/ui';
import { track, trackUi } from '../services/analytics';

interface SocialLink {
  name: string;
  href: string;
  /** data-analytics label used for auto-capture + explicit tracking. */
  analytics: string;
  Icon: () => JSX.Element;
}

function XIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}

function InstagramIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.6" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.3" cy="6.7" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function YouTubeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19 31.7 31.7 0 0 0 0 12a31.7 31.7 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14A31.7 31.7 0 0 0 24 12a31.7 31.7 0 0 0-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z" />
    </svg>
  );
}

function DiscordIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04c-1.7.29-3.34.8-4.88 1.52a.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.05a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.02c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.13c.13-.1.25-.19.37-.3a.07.07 0 0 1 .08 0c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08 0c.12.11.25.2.37.3a.08.08 0 0 1 0 .12c-.6.35-1.22.64-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6.03-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z" />
    </svg>
  );
}

const SOCIAL_LINKS: SocialLink[] = [
  { name: 'X', href: 'https://x.com/Harshit01631557', analytics: 'social_x', Icon: XIcon },
  { name: 'Instagram', href: 'https://www.instagram.com/words.of.word/', analytics: 'social_instagram', Icon: InstagramIcon },
  { name: 'YouTube', href: 'https://youtube.com/@jugaad-e-harshit?si=zgSH4mNPBRzAQxTg', analytics: 'social_youtube', Icon: YouTubeIcon },
  { name: 'Discord', href: 'https://discord.gg/Btf4UB3JFm', analytics: 'social_discord', Icon: DiscordIcon }
];

function SocialIconLink({ link }: { link: SocialLink }): JSX.Element {
  const { name, href, analytics, Icon } = link;

  function handleClick(): void {
    track('social_link_click', { platform: name, href }, 'click');
  }

  return (
    <Tooltip content={name} className="social-link-tip">
      <a
        className="social-icon"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={name}
        data-analytics={analytics}
        onClick={handleClick}
      >
        <Icon />
      </a>
    </Tooltip>
  );
}

export default function SocialPage(): JSX.Element {
  const navigate = useNavigate();

  function play(): void {
    trackUi('social_play');
    navigate('/');
  }

  return (
    <main className="social-shell">
      <section className="social-card">
        <span className="social-eyebrow">words of word</span>
        <h1 className="social-title">
          Follow the <em>word</em>
        </h1>
        <p className="social-sub">
          Join the community — new puzzles, updates, and behind-the-words moments.
        </p>

        <Button variant="primary" size="lg" className="social-play" onClick={play}>
          Play the game →
        </Button>

        <div className="social-links" aria-label="Follow us on social media">
          {SOCIAL_LINKS.map((link) => (
            <SocialIconLink key={link.name} link={link} />
          ))}
        </div>
      </section>
    </main>
  );
}
