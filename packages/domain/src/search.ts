/**
 * Search words that mean the same thing (I-39). Each group is spellings of one thing, as buyers and sellers in Hyderabad write them.
 * Kept here, pure, so it is tested and can later be edited from the admin console (I-41) without touching the query.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['kurti', 'kurta', 'kurtis', 'kurtas'],
  ['sari', 'saree', 'sarees', 'saris', 'sadi'],
  ['lehenga', 'lehnga', 'lengha', 'lehengha', 'ghagra', 'ghaghra', 'lehengas', 'chaniya'],
  ['salwar', 'shalwar', 'salwaar', 'shalwaar', 'suit', 'suits'],
  ['dupatta', 'dupattas', 'chunni', 'chunri', 'odhni', 'stole'],
  ['anarkali', 'anarkalis', 'anarkalli'],
  ['palazzo', 'palazo', 'pallazo', 'palazzos'],
  ['blouse', 'blouses', 'choli'],
  ['sherwani', 'shervani', 'sherwanis'],
  ['tshirt', 't-shirt', 'tee', 'tees', 'tshirts', 't-shirts'],
  ['jeans', 'denim', 'jean'],
  ['jacket', 'jackets', 'blazer', 'blazers', 'coat'],
  ['sneakers', 'sneaker', 'shoes', 'shoe', 'trainers'],
  ['sandals', 'sandal', 'chappal', 'chappals', 'slippers'],
  ['bag', 'bags', 'handbag', 'handbags', 'purse'],
  ['jewellery', 'jewelry', 'jewellry', 'jwellery', 'jewels'],
  ['bangles', 'bangle', 'kangan', 'choodi', 'churi', 'churiyan'],
  ['earrings', 'earring', 'jhumka', 'jhumkas', 'jhumki', 'studs'],
  ['cotton', 'khadi'],
  ['wedding', 'shaadi', 'bridal', 'marriage'],
  ['festive', 'festival', 'ethnic'],
];

const GROUP_OF: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>();
  for (const g of SYNONYM_GROUPS) for (const w of g) m.set(w, g);
  return m;
})();

/** At most this many spellings per word go into a query, so one word cannot make the query huge. */
export const MAX_VARIANTS_PER_TERM = 8;

/**
 * The spellings one search word is matched as: the word itself first, then its plural-stripped form, then the rest of its
 * synonym group. The word the buyer typed always comes first, so an exact match can be ranked above a synonym match.
 */
export function expandSearchTerm(term: string): string[] {
  const t = term.toLowerCase();
  const out: string[] = [t];
  const add = (w: string) => {
    if (w && !out.includes(w)) out.push(w);
  };
  if (t.length >= 5 && t.endsWith('s') && !t.endsWith('ss')) add(t.slice(0, -1));
  for (const w of [...out]) for (const s of GROUP_OF.get(w) ?? []) add(s);
  return out.slice(0, MAX_VARIANTS_PER_TERM);
}

/** Relevance points for one search word, by where it matched. The highest single match counts; a word that matches nowhere is 0. */
export const RELEVANCE = {
  TITLE: 40,
  TAG: 30,
  CATEGORY: 25,
  SHOP: 20,
  DESCRIPTION: 10,
  /** Per-field points are cut to this share when the match is only a synonym or a close spelling rather than the buyer's own word. */
  SYNONYM_PERCENT: 80,
  FUZZY_PERCENT: 60,
} as const;

/** The smallest word-similarity (pg_trgm) that counts as the same word misspelt, and the shortest word it is tried on. */
export const FUZZY_MIN_SIMILARITY = 0.55;
export const FUZZY_MIN_CHARS = 4;

/** Relevance points are multiplied by this before the ranking score is added, so relevance always wins and ranking breaks ties. */
export const RELEVANCE_SCALE = 1_000_000;
