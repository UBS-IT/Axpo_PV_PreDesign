// Area categories of step 1 and the automatic classification of imported objects. Pure module (no SDK).
// Categories, types and attributes follow the shared "site-features" model 1.1.0 (AGOL Axpo
// schemas/site_features_model.json), also used by the Geoportale and by the AGOL layer «IT - Site Features»:
// objects coming from there carry their codes and are never guessed.
import { geomKind, linearTypeFor } from './state.js';

// geom: geometry kinds accepted; cuts: removed from the buildable area; attrs: per-object attributes
export const CATEGORIES = [
  { id: 'gross', colour: [255, 140, 26], geom: ['polygon'], cuts: false, attrs: [] },
  { id: 'net', colour: [45, 190, 126], geom: ['polygon'], cuts: false, attrs: [] },
  // the cable route to the point of connection (model 1.1.0): shown with its length, never cut from the site
  { id: 'connection', colour: [139, 92, 246], geom: ['line'], cuts: false, attrs: ['type'],
    types: ['estimated', 'confirmed'] },
  { id: 'exclusion', colour: [229, 72, 77], geom: ['polygon', 'line', 'point'], cuts: true, attrs: ['type', 'buffer'],
    types: ['landscape', 'archaeological', 'cultural-heritage', 'protected-area', 'planning', 'sector-plan', 'flood',
      'steep-slope', 'woodland', 'watercourse', 'dpa', 'setback', 'other'] },
  { id: 'linear', colour: [233, 30, 140], geom: ['line'], cuts: true, attrs: ['type', 'buffer', 'voltage'],
    types: ['overhead-power', 'underground-power', 'gas', 'water', 'ditch', 'road', 'railway', 'other'] },
  { id: 'obstacle', colour: [150, 90, 40], geom: ['point', 'polygon', 'line'], cuts: true, attrs: ['type', 'height', 'buffer'],
    types: ['tree', 'pole', 'building', 'other'] },
  { id: 'access', colour: [31, 153, 204], geom: ['point', 'line'], cuts: false, attrs: ['type'],
    types: ['site-access', 'grid-connection'] },
  { id: 'mitigation', colour: [110, 170, 60], geom: ['polygon', 'line'], cuts: true, attrs: ['type', 'width'],
    types: ['hedge', 'green-screen', 'other'] },
  { id: 'agri', colour: [200, 170, 40], geom: ['polygon', 'line'], cuts: true, attrs: ['type', 'width'],
    types: ['crop', 'pasture', 'other'] },
  { id: 'reference', colour: [123, 138, 153], geom: ['polygon', 'line', 'point'], cuts: false, attrs: ['type'],
    types: ['note', 'photo', 'survey-route', 'measurement', 'other'] },
];
// voltage only for power lines
export const POWER_TYPES = ['overhead-power', 'underground-power'];

// Old Geoportale / Site Notes categories → [category, type], by geometry (same table as the model)
export const FROM_SITE_NOTES = {
  point: { 'beni interesse culturale': ['exclusion', 'cultural-heritage'], 'costruzioni e antropizzazioni': ['obstacle', 'building'],
    'rilievo fotografico': ['reference', 'photo'], 'alberi e vegetazione': ['obstacle', 'tree'], 'idrografia': ['exclusion', 'watercourse'] },
  line: { 'elettrodotto': ['linear', 'overhead-power'], 'idrografia': ['linear', 'ditch'], 'acquedotto': ['linear', 'water'],
    'gasdotti': ['linear', 'gas'], 'viabilita': ['linear', 'road'], 'accessi': ['access', 'site-access'],
    'manufatti e interferenze': ['linear', 'other'], 'percorso sopralluogo': ['reference', 'survey-route'], 'ferrovia': ['linear', 'railway'] },
  polygon: { 'perimetro netto': ['net', null], 'vincoli paesaggistici': ['exclusion', 'landscape'], 'vincoli archeologici': ['exclusion', 'archaeological'],
    'vincoli beni culturali': ['exclusion', 'cultural-heritage'], 'vincoli da piani': ['exclusion', 'planning'],
    'vincoli da piani di settore': ['exclusion', 'sector-plan'], 'pendenze alte': ['exclusion', 'steep-slope'],
    'edifici ed aree rilevanti': ['obstacle', 'building'], 'vegetazione': ['exclusion', 'woodland'],
    'misurazioni': ['reference', 'measurement'], 'dpa': ['exclusion', 'dpa'] },
};
const plainKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
// Objects drawn without a category (the default of the drawing menu, decision of 2026-10-10): they wait in the Layers
// panel until the designer gives each one its category. Not a category of the site-features model: it never leaves
// the app (no export takes it), it cuts nothing and no step counts it; the project file keeps it.
export const UNCLASSIFIED = 'unclassified';
const PENDING = { id: UNCLASSIFIED, colour: [150, 160, 172], geom: ['polygon', 'line', 'point'], cuts: false, attrs: [], pending: true };
export const CATEGORY = Object.fromEntries([...CATEGORIES, PENDING].map(c => [c.id, c]));
// the objects that count: every object with a category of the model
export const classified = features => features.filter(f => f.category !== UNCLASSIFIED);

export function accepts(categoryId, geometry) {
  const c = CATEGORY[categoryId];
  return !!c && c.geom.includes(geomKind(geometry));
}

// Keywords in names, KML folders, layer names (IT, EN, FR, ES, DE, PL)
// Order matters: the first match whose category takes the geometry wins, and the generic "gross" words come last.
const CONNECTION_RE = /percorso di connessione|connection route|cable route|grid route|tracciato (del )?cavo|trac[ée] de raccordement|trazado de (la )?conexi|kabeltrasse|trasa kabl/;
const KEYWORDS = [
  ['net', /perimetro netto|\bnet(to|ta|te)?\b|\bnetta\b|neto\b|buildable|surface utile|zone utile|nutzbar/],
  // before «access»: its «connection point» words would otherwise take the cable route. Only route words: a plain
  // «cavidotto» or «cable» is an existing line (linear infrastructure), not our route
  ['connection', CONNECTION_RE],
  ['access', /access|ingress|entrance|entr[ée]e|acceso|zufahrt|einfahrt|wjazd|\bgate\b|cancell|portail|connection point|punto di connessione|point de raccordement|punto de conexi|netzanschluss|przył[aą]cz|\bpod\b/],
  ['mitigation', /mitigaz|mitigation|siepe|hedge|haie|seto|hecke|żywop|fascia verde|green belt|écran végétal|pantalla vegetal/],
  ['agri', /agricol|agricultural|culture|cultivo|coltiv|pascol|pâtur|pasture|weide|pastwisk|farming/],
  ['obstacle', /\btree|alber|arbre|árbol|arbol|\bbaum|drzew|\bpole\b|\bpalo|poteau|\bmast\b|słup|pylon|traliccio|building|edific|fabbricat|bâtiment|batiment|gebäude|gebaude|budyn|obstacle|ostacol|hindernis|przeszk/],
  ['exclusion', /exclu|vincol|constraint|contrainte|restric|restrizion|ausschluss|wyłącz|wylacz|natura 2000|\bsic\b|\bzps\b|flood|esondaz|inondab|inondation|pendenz|slope|pente|pendiente|hangneig|nachylen|\bdpa\b|buffer|rispetto|servitud|servitù|servitude/],
  ['gross', /\bgross\b|\blord[oa]\b|\bbrut(e|o|a|to)?\b|bruttofl|site boundary|perimetro|lease|\boption\b|emprise|foncier|gesamtfl|\bsite\b|\bsito\b/],
];

// lower case, underscores as spaces (layer names such as "Area_lorda")
const norm = text => String(text || '').toLowerCase().replace(/_/g, ' ');

// A category that does not take the geometry lets the next match through: a point «Punto di connessione» in a
// KML folder «Percorso di connessione» is an access point, not a (line-only) connection route
function keywordCategory(text, geometry) {
  const s = norm(text);
  for (const [cat, re] of KEYWORDS) if (re.test(s) && accepts(cat, geometry)) return cat;
  return null;
}

// Obstacle type from text
function obstacleType(text) {
  const s = norm(text);
  if (/tree|alber|arbre|árbol|arbol|baum|drzew|vegetaz|vegetation/.test(s)) return 'tree';
  if (/pole|palo|poteau|mast|słup|pylon|traliccio|pylône|poste/.test(s)) return 'pole';
  if (/building|edific|fabbricat|costruzion|bâtiment|batiment|gebäude|gebaude|budyn|house|casa|maison/.test(s)) return 'building';
  return 'other';
}

// Geoportale (.axpo) drawings made before the site-features model: their old category (the IT Sites Notes
// domains), exactly through FROM_SITE_NOTES, then by keywords for anything else
function axpoCategory(cat, kind) {
  const exact = (FROM_SITE_NOTES[kind] || {})[plainKey(cat)];
  if (exact) return { category: exact[0], attrs: exact[1] ? { type: exact[1] } : {} };
  const c = String(cat || '').toLowerCase();
  if (!c) return null;
  if (/perimetro netto/.test(c)) return kind === 'polygon' ? { category: 'net' } : null;
  if (/accessi/.test(c)) return { category: 'access', attrs: { type: 'site-access' } };
  if (/alberi|vegetazione/.test(c) && kind !== 'polygon') return { category: 'obstacle', attrs: { type: 'tree' } };
  if (/costruzioni|antropizzazioni|edifici/.test(c) && kind === 'point') return { category: 'obstacle', attrs: { type: 'building' } };
  if (kind === 'line') {
    const lin = linearTypeFor(c);
    if (lin) return { category: 'linear', attrs: { type: lin } };
  }
  if (/vincol|pendenze alte|\bdpa\b|edifici ed aree rilevanti|vegetazione|idrografia|beni interesse|manufatti/.test(c)) return { category: 'exclusion' };
  if (/misurazioni|percorso sopralluogo|rilievo fotografico/.test(c)) return { category: 'reference' };
  return null;
}

// Decide the category of one imported object.
// f: { name, geometry, sourceCategory (axpo category / KML folder / layer), kind (axpo _kind), properties }
// ctx: { type: 'axpo'|'geojson'|'kml'|'shp'|'csv', polygonsInFile }
export function classify(f, ctx = {}) {
  const kind = geomKind(f.geometry);
  const props = f.properties || {};
  // an explicit category: written by this app (GeoJSON round trip), by the Geoportale (.axpo, GeoJSON export) or
  // read from the AGOL layer «IT - Site Features» — never guessed
  const explicit = props.category || props.role;
  if (explicit && CATEGORY[explicit] && accepts(explicit, f.geometry)) return { category: explicit, attrs: pickAttrs(props, explicit) };
  if (ctx.type === 'axpo') {
    if (f.kind === 'parcel') return { category: 'reference', attrs: {} };
    const a = axpoCategory(f.sourceCategory, kind);
    if (a && accepts(a.category, f.geometry)) return { category: a.category, attrs: a.attrs || {} };
    return { category: 'reference', attrs: {} };
  }
  const text = [f.sourceCategory, f.name].filter(Boolean).join(' ');
  if (kind === 'line') {
    if (CONNECTION_RE.test(norm(text))) return { category: 'connection', attrs: {} };   // before the power-line words
    const lin = linearTypeFor(text);
    if (lin) return { category: 'linear', attrs: { type: lin } };
  }
  const height = Number(props.height ?? props.h ?? props.altezza ?? props.hauteur ?? props.altura ?? props.hoehe);
  const kw = keywordCategory(text, f.geometry);
  if (kw) {
    const attrs = kw === 'obstacle' ? { type: obstacleType(text) } : kw === 'access' ? { type: /connect|connessione|raccordement|conexi|anschluss|przył|\bpod\b/i.test(text) ? 'grid-connection' : 'site-access' } : {};
    if (kw === 'obstacle' && height > 0) attrs.height = height;
    return { category: kw, attrs };
  }
  // points with a height (e.g. surveyed trees or poles in a CSV) are obstacles
  if (kind === 'point' && height > 0) return { category: 'obstacle', attrs: { type: obstacleType(text), height } };
  // a file with a few polygons and no hint: most likely the site boundary
  if (kind === 'polygon' && (ctx.polygonsInFile || 0) <= 3) return { category: 'gross', attrs: {} };
  return { category: 'reference', attrs: {} };
}

// attributes of an explicit category that make sense for it: a type from its list, non-negative numbers
function pickAttrs(props, category) {
  const c = CATEGORY[category], a = {};
  if (!c) return a;
  if (c.attrs.includes('type') && c.types.includes(props.type)) a.type = props.type;
  for (const k of ['buffer', 'height', 'width', 'voltage']) {
    const v = Number(props[k]);
    if (c.attrs.includes(k) && props[k] !== null && props[k] !== '' && isFinite(v) && v >= 0) a[k] = v;
  }
  if (a.voltage !== undefined && !POWER_TYPES.includes(a.type)) delete a.voltage;
  return a;
}
