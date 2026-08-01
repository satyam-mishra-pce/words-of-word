import type { PlayerAvatar } from '@wow/shared';

export type PlayerAvatarCharacterSet = PlayerAvatar['characterSet'];
export type PlayerAvatarPart = Exclude<keyof PlayerAvatar, 'engine' | 'characterSet'>;

interface AtlasPart {
  xOffset: number;
  staticYOffset: number;
  spriteSize: number;
  spriteVariants: number;
}

interface AtlasManifest {
  parts: Record<string, AtlasPart>;
}

interface AtlasResource {
  image: HTMLImageElement;
  manifest: AtlasManifest;
}

export const PLAYER_AVATAR_CHARACTER_SETS: ReadonlyArray<{ value: PlayerAvatarCharacterSet; label: string }> = [
  { value: 'adult', label: 'Adult' },
  { value: 'oldman', label: 'Elder' },
  { value: 'nekonin', label: 'Animal' },
  { value: 'children', label: 'Child' }
];

export const PLAYER_AVATAR_PARTS: ReadonlyArray<{ value: PlayerAvatarPart; label: string; optional?: boolean }> = [
  { value: 'skin', label: 'Skin' },
  { value: 'eyes', label: 'Eyes' },
  { value: 'hair', label: 'Hair', optional: true },
  { value: 'hairadd', label: 'Hair extras', optional: true },
  { value: 'clothes', label: 'Outfit', optional: true },
  { value: 'hat', label: 'Hat', optional: true },
  { value: 'glasses', label: 'Glasses', optional: true },
  { value: 'cloak', label: 'Cloak', optional: true },
  { value: 'beard', label: 'Beard', optional: true },
  { value: 'makeup', label: 'Makeup', optional: true },
  { value: 'ear', label: 'Ears', optional: true },
  { value: 'tail', label: 'Tail', optional: true },
  { value: 'item', label: 'Item', optional: true }
];

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** The valid source IDs from Simocracy's Pipoya character sheets. */
const CHARACTER_PART_IDS: Record<PlayerAvatarCharacterSet, Record<PlayerAvatarPart, number[]>> = {
  adult: {
    skin: range(1, 33),
    clothes: [...range(1, 9), ...range(13, 24), ...range(32, 61), 69, 70],
    eyes: range(1, 35),
    hair: range(1, 68),
    hairadd: range(1, 12),
    hat: range(1, 26),
    glasses: range(1, 10),
    cloak: range(1, 9),
    makeup: range(1, 4),
    beard: range(1, 8),
    ear: range(1, 14),
    tail: [5, 6, 7, 8],
    item: range(1, 31)
  },
  oldman: {
    skin: range(1, 17),
    clothes: range(1, 2),
    eyes: range(1, 30),
    hair: range(1, 68),
    hairadd: [],
    hat: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11],
    glasses: range(1, 4),
    cloak: range(1, 3),
    makeup: range(1, 3),
    beard: range(1, 8),
    ear: range(1, 9),
    tail: range(1, 4),
    item: []
  },
  nekonin: {
    skin: range(1, 17),
    clothes: range(1, 9),
    eyes: range(1, 23),
    hair: [],
    hairadd: [],
    hat: range(1, 27),
    glasses: range(1, 12),
    cloak: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 22, 23, 24, 25, 26],
    makeup: range(1, 7),
    beard: [1],
    ear: range(1, 2),
    tail: range(1, 41),
    item: []
  },
  children: {
    skin: range(1, 17),
    clothes: range(1, 4),
    eyes: range(1, 30),
    hair: range(1, 20),
    hairadd: [],
    hat: range(1, 2),
    glasses: range(1, 4),
    cloak: range(1, 3),
    makeup: [],
    beard: [],
    ear: range(1, 9),
    tail: range(1, 4),
    item: []
  }
};

const OPTIONAL_PARTS = new Set<PlayerAvatarPart>(
  PLAYER_AVATAR_PARTS.filter((part) => part.optional).map((part) => part.value)
);
const ADULT_FULL_BODY_SKIN_IDS = new Set([13, 14, 15, 16]);
const atlasCache = new Map<PlayerAvatarCharacterSet, Promise<AtlasResource | null>>();
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

const SOURCE_FOLDERS: Record<string, string> = {
  skin: '00Skin',
  clothes: '01Costume',
  eyes: '02Eye',
  hair: '03Hair',
  'hair$': '03Hair$',
  hairhat: '03HairHat',
  'hairhat$': '03HairHat$',
  hairadd: '04HairAdd',
  'hairadd$': '04HairAdd$',
  hat: '05Hat',
  'hat$': '05Hat$',
  glasses: '06Glasses',
  cloak: '07Cloak',
  'cloak$': '07Cloak$',
  makeup: '08Makeup',
  beard: '09Beard',
  ear: '10Ear',
  'ear$': '10Ear$',
  tail: '11Tail',
  'tail$': '11Tail$',
  item: '12Item',
  'item$': '12Item$'
};

const THUMBNAIL_FRAMES: Partial<Record<PlayerAvatarPart, 4 | 5>> = {
  hairadd: 4,
  tail: 4
};

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`.replace(/([^:]\/)\/+/, '$1');
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached) return cached;

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  imageCache.set(src, request);
  return request;
}

async function loadAtlas(characterSet: PlayerAvatarCharacterSet): Promise<AtlasResource | null> {
  const existing = atlasCache.get(characterSet);
  if (existing) return existing;

  const request = Promise.all([
    fetch(assetUrl(`pipoya-atlases/${characterSet}/mega-atlas.json`)).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${characterSet} avatar atlas`);
      return response.json() as Promise<AtlasManifest>;
    }),
    loadImage(assetUrl(`pipoya-atlases/${characterSet}/mega-static.webp`))
  ])
    .then(([manifest, image]) => (image ? { manifest, image } : null))
    .catch(() => null);

  atlasCache.set(characterSet, request);
  return request;
}

function drawAtlasPart(
  context: CanvasRenderingContext2D,
  atlas: AtlasResource,
  part: string,
  value: number,
  width: number,
  height: number
): boolean {
  if (!value) return false;
  const details = atlas.manifest.parts[part];
  if (!details || value > details.spriteVariants) return false;

  const size = details.spriteSize || 32;
  context.drawImage(
    atlas.image,
    details.xOffset + (value - 1) * size,
    details.staticYOffset,
    size,
    size,
    0,
    0,
    width,
    height
  );
  return true;
}

async function drawSourcePart(
  context: CanvasRenderingContext2D,
  characterSet: PlayerAvatarCharacterSet,
  part: string,
  value: number,
  width: number,
  height: number,
  frame = 5
): Promise<boolean> {
  if (!value) return false;
  const folder = SOURCE_FOLDERS[part];
  if (!folder) return false;

  const image = await loadImage(assetUrl(`pipoya-sprites/${characterSet}/${frame}/${folder}/${value}.png`));
  if (!image) return false;

  context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, width, height);
  return true;
}

async function drawPart(
  context: CanvasRenderingContext2D,
  atlas: AtlasResource | null,
  characterSet: PlayerAvatarCharacterSet,
  part: string,
  value: number,
  width: number,
  height: number
): Promise<void> {
  if (atlas && drawAtlasPart(context, atlas, part, value, width, height)) return;
  await drawSourcePart(context, characterSet, part, value, width, height);
}

/** Draw a static Pipoya character using the same layer ordering as Simocracy. */
export async function renderPlayerAvatar(canvas: HTMLCanvasElement, avatar: PlayerAvatar): Promise<boolean> {
  const context = canvas.getContext('2d');
  if (!context) return false;

  const atlas = await loadAtlas(avatar.characterSet);

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;

  const hairPart = avatar.hat ? 'hairhat' : 'hair';
  const hairBackPart = avatar.hat ? 'hairhat$' : 'hair$';

  // Behind-body layers.
  await drawPart(context, atlas, avatar.characterSet, 'item$', avatar.item, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'hat$', avatar.hat, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'hairadd$', avatar.hairadd, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'ear$', avatar.ear, width, height);
  await drawPart(context, atlas, avatar.characterSet, hairBackPart, avatar.hair, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'cloak$', avatar.cloak, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'tail$', avatar.tail, width, height);

  // Body and foreground layers.
  await drawPart(context, atlas, avatar.characterSet, 'skin', avatar.skin, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'makeup', avatar.makeup, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'eyes', avatar.eyes, width, height);
  if (!(avatar.characterSet === 'adult' && ADULT_FULL_BODY_SKIN_IDS.has(avatar.skin))) {
    await drawPart(context, atlas, avatar.characterSet, 'clothes', avatar.clothes, width, height);
  }
  await drawPart(context, atlas, avatar.characterSet, 'tail', avatar.tail, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'cloak', avatar.cloak, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'beard', avatar.beard, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'glasses', avatar.glasses, width, height);
  await drawPart(context, atlas, avatar.characterSet, hairPart, avatar.hair, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'ear', avatar.ear, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'hairadd', avatar.hairadd, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'hat', avatar.hat, width, height);
  await drawPart(context, atlas, avatar.characterSet, 'item', avatar.item, width, height);

  return true;
}

/** Render a single selectable layer, so customization choices are visually distinct. */
export async function renderPlayerAvatarPart(
  canvas: HTMLCanvasElement,
  characterSet: PlayerAvatarCharacterSet,
  part: PlayerAvatarPart,
  value: number
): Promise<boolean> {
  const context = canvas.getContext('2d');
  if (!context) return false;

  const atlas = await loadAtlas(characterSet);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  // Source layers retain every available Simocracy option. The static atlas
  // is a fast fallback, while the source image supplies variants omitted from
  // its compact static tier (notably many Elder hair and beard choices).
  const thumbnailFrame = THUMBNAIL_FRAMES[part] ?? 5;
  if (await drawSourcePart(context, characterSet, part, value, canvas.width, canvas.height, thumbnailFrame)) return true;
  return atlas ? drawAtlasPart(context, atlas, part, value, canvas.width, canvas.height) : false;
}

export function getPlayerAvatarPartOptions(characterSet: PlayerAvatarCharacterSet, part: PlayerAvatarPart): number[] {
  return CHARACTER_PART_IDS[characterSet][part];
}

export function isOptionalPlayerAvatarPart(part: PlayerAvatarPart): boolean {
  return OPTIONAL_PARTS.has(part);
}

/** Make a valid, varied Pipoya recipe for a new player or the surprise action. */
export function randomizePlayerAvatar(characterSet: PlayerAvatarCharacterSet = 'adult'): PlayerAvatar {
  const values = CHARACTER_PART_IDS[characterSet];
  const next = {
    engine: 'pipoya' as const,
    characterSet,
    skin: pick(values.skin),
    clothes: values.clothes.length ? pick(values.clothes) : 0,
    eyes: pick(values.eyes),
    hair: values.hair.length ? pick(values.hair) : 0,
    hairadd: 0,
    hat: 0,
    glasses: 0,
    cloak: 0,
    makeup: 0,
    beard: 0,
    ear: 0,
    tail: 0,
    item: 0
  } satisfies PlayerAvatar;

  for (const part of PLAYER_AVATAR_PARTS) {
    if (!part.optional) continue;
    const options = values[part.value];
    if (options.length && Math.random() < 0.42) next[part.value] = pick(options);
  }

  if (characterSet === 'adult' && ADULT_FULL_BODY_SKIN_IDS.has(next.skin)) next.clothes = 0;
  return next;
}
