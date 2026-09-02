import { inLibrary } from '../routes/sources';
import { getSource } from './sources';

const API = 'https://api.mangadex.org';
const HEADERS = { 'user-agent': 'Uchiyomi/1.0 (self-hosted personal reader)' };
const RATINGS = ['safe', 'suggestive'].map((r) => `contentRating[]=${r}`).join('&');

export const GENRE_MAP: Record<string, string> = {
  Action: '391b0423-d847-456f-aff0-8b0cfc03066b',
  Adventure: '87cc87cd-a395-47af-b27a-93258283bbc6',
  Comedy: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
  Drama: 'b9af3a63-f058-46de-a9a0-e0c13906197a',
  Fantasy: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
  Horror: 'cdad7e68-1419-41dd-bdce-27753074a640',
  Mystery: 'ee968100-4191-4968-93d3-f82d72be7e46',
  Psychological: '3b60b75c-a2d7-4860-ab56-05f391bb889c',
  Romance: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
  'Sci-Fi': '256c8bd9-4904-4360-bf4f-508a76d67183',
  Supernatural: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
  Thriller: '07251805-a27e-4d59-b488-f0bfbec15168',
  'Slice of Life': 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9',
  Sports: '69964a64-2f90-4d33-beeb-f3ed2875eb4c',
};

export const TAG_MAP: Record<string, string> = {
  Isekai: 'ace04997-f6bd-436e-b261-779182193d3d',
  Reincarnation: '0bc90acb-ccc1-44ca-a34a-b9f3a73259d0',
  'Martial Arts': '799c202e-7daa-44eb-9cf7-8a3c0441531e',
  Survival: '5fff9cde-849c-4d78-aab0-0d52b2ee1d25',
  'Time Travel': '292e862b-2d17-4062-90a2-035642a05e32',
  'Post-Apocalyptic': '9467335a-1b83-4497-9231-765337a00b96',
  Monsters: '36fd93ea-e8b8-445e-b2b1-1c7071ce4019',
  Magic: 'a1f53773-c69a-4ce5-8cab-fffcd90b1565',
  'Video Games': '9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8',
  Villainess: 'd14322ac-4d6f-4e9b-afd9-629d5f4d8a41',
};

export const AVAILABLE_LANGUAGES = [
  { id: 'all', label: 'All Languages' },
  { id: 'en', label: '🇬🇧 English' },
  { id: 'ar', label: '🇸🇦 Arabic' },
  { id: 'es', label: '🇪🇸 Spanish' },
  { id: 'fr', label: '🇫🇷 French' },
  { id: 'ja', label: '🇯🇵 Japanese' },
  { id: 'ko', label: '🇰🇷 Korean' },
  { id: 'zh', label: '🇨🇳 Chinese' },
];

export interface ExploreParams {
  genre?: string;
  tag?: string;
  format?: 'all' | 'manhwa' | 'manga' | 'manhua';
  sort?: 'trending' | 'rating' | 'latest';
  lang?: string;
  source?: string;
  q?: string;
  page?: number;
}

export interface ExploreItem {
  id: string;
  source?: string;
  title: string;
  coverUrl?: string;
  summary?: string;
  genres: string[];
  status?: string;
  format?: 'manhwa' | 'manga' | 'manhua';
  rating?: number;
  inLibrary?: boolean;
}

// 10-minute in-memory cache
const exploreCache = new Map<string, { at: number; items: ExploreItem[] }>();
const CACHE_TTL = 10 * 60_000;

function firstLang(obj: any): string {
  if (!obj) return '';
  return obj.en || obj['ja-ro'] || obj['ko-ro'] || (Object.values(obj)[0] as string) || '';
}

export async function exploreManga(params: ExploreParams): Promise<ExploreItem[]> {
  const page = Math.max(1, params.page || 1);
  const cacheKey = JSON.stringify({ ...params, page });
  const hit = exploreCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return hit.items;
  }

  // If a specific non-MangaDex provider is selected, query that provider directly
  if (params.source && params.source !== 'all' && params.source !== 'mangadex') {
    const src = getSource(params.source);
    if (src) {
      try {
        let results: any[] = [];
        if (params.q?.trim()) {
          results = await src.search(params.q.trim());
        } else if (params.genre && params.genre !== 'all') {
          results = await src.search(params.genre);
        } else if (params.sort === 'latest' && src.latest) {
          results = await src.latest(page);
        } else if (src.popular) {
          results = await src.popular(page);
        } else {
          results = await src.search('manga');
        }

        const items: ExploreItem[] = results.map((r) => ({
          id: r.sourceId,
          source: params.source,
          title: r.title,
          coverUrl: r.coverUrl,
          summary: r.summary,
          genres: r.genres || [],
          status: r.status,
          format: params.format !== 'all' ? params.format : undefined,
        }));

        const titles = items.map((it) => it.title);
        const haveSet = await inLibrary(titles).catch(() => new Set<string>());
        items.forEach((it) => {
          it.inLibrary = haveSet.has(it.title.toLowerCase().replace(/[^a-z0-9]+/g, ''));
        });

        exploreCache.set(cacheKey, { at: Date.now(), items });
        return items;
      } catch (e) {
        // fallback to mangadex if specific source query fails
      }
    }
  }

  const queryParts: string[] = [
    `limit=24`,
    `offset=${(page - 1) * 24}`,
    `hasAvailableChapters=true`,
    `includes[]=cover_art`,
    RATINGS,
  ];

  if (params.q?.trim()) {
    queryParts.push(`title=${encodeURIComponent(params.q.trim())}`);
  }

  // Translated language filter
  if (params.lang && params.lang !== 'all') {
    queryParts.push(`availableTranslatedLanguage[]=${encodeURIComponent(params.lang)}`);
  }

  // Format mapping to originalLanguage
  if (params.format === 'manhwa') {
    queryParts.push(`originalLanguage[]=ko`);
  } else if (params.format === 'manga') {
    queryParts.push(`originalLanguage[]=ja`);
  } else if (params.format === 'manhua') {
    queryParts.push(`originalLanguage[]=zh`);
  }

  // Included tags (Genre + Tag)
  const tagIds: string[] = [];
  if (params.genre && GENRE_MAP[params.genre]) {
    tagIds.push(GENRE_MAP[params.genre]);
  }
  if (params.tag && TAG_MAP[params.tag]) {
    tagIds.push(TAG_MAP[params.tag]);
  }
  for (const tid of tagIds) {
    queryParts.push(`includedTags[]=${tid}`);
  }
  if (tagIds.length > 1) {
    queryParts.push(`includedTagsMode=AND`);
  }

  // Sorting
  if (params.sort === 'rating') {
    queryParts.push(`order[rating]=desc`);
  } else if (params.sort === 'latest') {
    queryParts.push(`order[latestUploadedChapter]=desc`);
  } else {
    // default: trending / most followed
    queryParts.push(`order[followedCount]=desc`);
  }

  const url = `${API}/manga?${queryParts.join('&')}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`mangadex explore ${res.status}`);
  }

  const data = (await res.json()) as any;
  const rawList: any[] = data?.data || [];

  const items: ExploreItem[] = rawList.map((m) => {
    const a = m.attributes || {};
    const cover = (m.relationships || []).find((r: any) => r.type === 'cover_art');
    const genres = (a.tags || [])
      .filter((t: any) => ['genre', 'theme'].includes(t.attributes?.group))
      .map((t: any) => firstLang(t.attributes?.name))
      .filter(Boolean);

    let format: 'manhwa' | 'manga' | 'manhua' | undefined;
    if (a.originalLanguage === 'ko') format = 'manhwa';
    else if (a.originalLanguage === 'ja') format = 'manga';
    else if (a.originalLanguage === 'zh') format = 'manhua';

    const title =
      firstLang(a.title) ||
      (a.altTitles || []).map((t: any) => t.en || firstLang(t)).find(Boolean) ||
      'Untitled';

    return {
      id: m.id,
      source: 'mangadex',
      title,
      summary: firstLang(a.description),
      genres,
      status: a.status ? String(a.status).toUpperCase() : undefined,
      format,
      coverUrl: cover?.attributes?.fileName
        ? `https://uploads.mangadex.org/covers/${m.id}/${cover.attributes.fileName}.256.jpg`
        : undefined,
    };
  });

  // Check which titles are in the local library
  const titles = items.map((it) => it.title);
  const haveSet = await inLibrary(titles).catch(() => new Set<string>());
  items.forEach((it) => {
    it.inLibrary = haveSet.has(it.title.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  });

  exploreCache.set(cacheKey, { at: Date.now(), items });
  return items;
}
