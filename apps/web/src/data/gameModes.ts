import type { GameSettings } from '@wow/shared';

export interface GameModeInfo {
  value: GameSettings['gameMode'] | 'daily';
  label: string;
  tagline: string;
  description: string;
  videoSrc?: string;
  posterSrc?: string;
}

export const GAME_MODE_INFO: GameModeInfo[] = [
  { value: 'classic', label: 'Classic', tagline: 'The pure word race.', description: 'Standard rules: every accepted word gives 3 points. Best for quick first games and fast friend battles.', videoSrc: '/marketing/classic-mode-video.mp4', posterSrc: '/marketing/classic-mode-preview.png' },
  { value: 'arcade', label: 'Score Attack', tagline: 'Longer words hit harder.', description: 'Reward bigger finds: every word gives 3 points plus bonus points equal to word length.', videoSrc: '/marketing/arcade-mode-score-attack-video.mp4', posterSrc: '/marketing/arcade-mode-score-attack-preview.png' },
  { value: 'precision', label: 'Precision', tagline: 'Accuracy matters.', description: 'Accepted words score 3 plus word length, wrong words lose 3 plus word length, and duplicates lose 3 points.', videoSrc: '/marketing/precision-mode-video.mp4', posterSrc: '/marketing/precision-mode-preview.png' },
  { value: 'teams', label: 'Teams', tagline: 'Red vs Blue.', description: 'Players pick Red or Blue before the game. Team totals and individual scores are both shown.', videoSrc: '/marketing/teams-mode-video.mp4', posterSrc: '/marketing/teams-mode-preview.png' },
  { value: 'betting', label: 'Betting', tagline: 'Call your shot.', description: 'Before each round, bet how many words you will make. Hit it for big points, miss it and lose the stake.', videoSrc: '/marketing/betting-mode-video.mp4', posterSrc: '/marketing/betting-mode-preview.png' },
  { value: 'fastestNWords', label: 'Word Sprint', tagline: 'First to the target wins.', description: 'First player to reach the target word count ends the round and earns a 10 point bonus.', videoSrc: '/marketing/word-sprint-mode-video.mp4', posterSrc: '/marketing/word-sprint-mode-preview.png' },
  { value: 'battleRoyale', label: 'Knockout', tagline: 'Survive the round.', description: 'Lowest scoring players are eliminated after each round until a winner emerges.', videoSrc: '/marketing/knockout-mode-video.mp4', posterSrc: '/marketing/knockout-mode-preview.png' },
  { value: 'typist', label: 'Blind Type', tagline: 'Type without seeing it.', description: 'Your typed word stays hidden until you submit it.', videoSrc: '/marketing/blind-type-mode-video.mp4', posterSrc: '/marketing/blind-type-mode-preview.png' },
  { value: 'category', label: 'Theme Challenge', tagline: 'Play a themed dictionary.', description: 'Source words come from the selected theme or your custom list.', videoSrc: '/marketing/theme-challenge-mode-video.mp4', posterSrc: '/marketing/theme-challenge-mode-preview.png' },
  { value: 'oneWordForAll', label: 'Claim Mode', tagline: 'One word, one owner.', description: 'Once any player claims a word, no one else can use it.', videoSrc: '/marketing/claim-mode-video.mp4', posterSrc: '/marketing/claim-mode-preview.png' },
  { value: 'busted', label: 'Busted Mode', tagline: 'Avoid the trap word.', description: 'Each player’s first word becomes their bust word. Type another player’s bust word and your round score explodes to 0. Matching first words are safe.', videoSrc: '/marketing/busted-mode-video.mp4', posterSrc: '/marketing/busted-mode-preview.png' },
  { value: 'commonWord', label: 'Common Word', tagline: 'Unique beats obvious.', description: 'Unique words score +3, rare unique words with 5+ letters score +5. Shared words give everyone who used them -3.', videoSrc: '/marketing/common-word-mode-video.mp4', posterSrc: '/marketing/common-word-mode-preview.png' },
  { value: 'intuition', label: 'Intuition Mode', tagline: 'Guess before the reveal.', description: 'The source word starts hidden and unlocks one random letter at a time over the round. You can guess words before they appear.', videoSrc: '/marketing/intuition-mode-video.mp4', posterSrc: '/marketing/intuition-mode-preview.png' },
  { value: 'lightning', label: 'Lightning Mode', tagline: 'Keep your timer alive.', description: 'Each player gets their own 10-second timer. Valid words add 1 second. If your timer hits zero, you are out for that round.', videoSrc: '/marketing/lightning-mode-video.mp4', posterSrc: '/marketing/lightning-mode-preview.png' },
  { value: 'bingo', label: 'Bingo Board', tagline: 'Complete word-hunt tasks.', description: 'Everyone gets the same 7 hard tasks. Each task gives 10 points; complete all 7 for a 100 point bonus, then extra valid words score 3.', videoSrc: '/marketing/bingo-mode-video.mp4', posterSrc: '/marketing/bingo-mode-preview.png' },
  { value: 'mix', label: 'Mix Mode', tagline: 'Stack the chaos.', description: 'Choose Classic or Score Attack scoring, then stack compatible modifiers: Teams, Word Sprint, Blind Type, Claim, Busted, Intuition, and Lightning.', videoSrc: '/marketing/mix-mode-video.mp4', posterSrc: '/marketing/mix-mode-preview.png' },
  { value: 'daily', label: 'Daily Word', tagline: 'A new solo challenge every day.', description: 'Play the same daily source word as everyone else, chase your personal best, and share the challenge link.', videoSrc: '/marketing/daily-word-to-post-video.mp4', posterSrc: '/marketing/daily-word-video-preview.png' }
];

export const ROOM_GAME_MODE_INFO = GAME_MODE_INFO.filter((mode): mode is GameModeInfo & { value: GameSettings['gameMode'] } => mode.value !== 'daily');
