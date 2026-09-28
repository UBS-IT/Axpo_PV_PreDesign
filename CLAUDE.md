# PV Predesign — web app di predesign fotovoltaico (gruppo Axpo / Urbasolar)

App web per il predesign 2D/3D di impianti fotovoltaici **a terra fissi** e **agrivoltaici**, per i team di
Italia, Polonia, Francia, Spagna, Germania e Svizzera. **Indipendente** dal Geoportale AxpoSolar Italia
(`../AGOL Axpo/tools/geoportale_axpo.html`), da cui importa solo i progetti `.axpo`.

## Regole fondamentali

1. **Interfaccia in inglese.** Tutti i testi visibili passano da `app/js/i18n.js` (niente stringhe sparse nel codice).
   Commenti del codice e README in inglese (progetto di gruppo); le conversazioni con l'utente restano in italiano.
2. **Solo il toolkit interno.** Strutture, edifici, recinzioni e regole vengono da `app/catalog/toolkit.json`,
   trascritto dai toolkit del gruppo (Design ESQ, `../AGOL Axpo/toolkit`; toolkit IT). **Archivio per paese in
   `docs/toolkit/`** (un file per paese + `group.md` per le scelte di gruppo + `sources.md`): ogni informazione nuova
   si scrive lì con fonte e stato (confirmed / verify / open), poi passa nel catalogo quando serve all'app. Valori di
   gruppo in cima al catalogo, valori di paese in `countries.<ISO>`: **mai prestati da un paese all'altro** (se manca,
   l'app dice che manca). Ogni valore porta la sua fonte; i non verificati hanno `"verify": true`. Non inventare
   parametri: se manca, chiederlo.
3. **Moduli gestiti dall'utente**: inseriti a mano o importati dalle roadmap (CSV/XLSX), più la lista dei moduli
   previsti per il progetto. Standard di gruppo (2026-09-25): solo bifacciali TOPCon 2382 × 1134, potenza per semestre
   dalla roadmap di gruppo (colonna «CS - PPA FR et EU»; avviso oltre 6 mesi dal caricamento; i prezzi non si leggono);
   3V9 a terra a 15° (mai spezzato), tracker 1V28 ±55° con interasse deciso con l'azienda agricola; mezze tabelle solo
   come opzione (1V14 per il 1V28). Variante NZIA della roadmap ignorata.
   Interfila, modulo (Wp) e tipo di struttura (notazione `nVm` / `nHm`) si scelgono a mano per ogni campo; l'app
   propone solo i minimi del toolkit e avvisa. I moduli usati viaggiano nel file di progetto.
4. **Misure esatte.** Il layout si calcola in una proiezione Trasversa di Mercatore locale centrata sul sito (scala 1):
   metri veri. Mai calcolare distanze in Web Mercator (non è conforme: errori dello 0,15-0,17% a 45°).
   Le riproiezioni le fa sempre l'SDK (`projectOperator`), che applica da solo la trasformazione di datum
   predefinita (Monte Mario, DHDN, CH1903), anche per un WKT; mai proj4/shpjs con il `.prj` (Monte Mario a 168 m).
5. **Backup prima di modifiche rischiose** in `backups/` (`<file>_pre-<motivo>_<data>`), come nel progetto AGOL Axpo.
6. **Parte elettrica**: volutamente aperta (l'utente raccoglie le informazioni, ~6 mesi). Non inventarla.
7. **Resa**: lo Yield tool interno esporrà un'API (non ancora disponibile). Fino ad allora kWh/kWp inseriti a mano.
8. **Predesign veloce e intuitivo** (utente, 2026-09-25): più accurato del solito, ma rapido. Le regole del toolkit
   sono default e suggerimenti, mai vincoli rigidi: il progettista decide (es. strada perimetrale proposta fino a
   ~9 MWp, non imposta). Le opzioni avanzate restano facoltative e non devono appesantire il percorso base.

## Lavoro tra sessioni

Tre sessioni di Claude Code lavorano sugli stessi progetti. Il punto d'incontro è `../AGOL Axpo/COORDINAMENTO.md`
(proprietà dei file, stato, richieste aperte, registro), deciso dall'utente il 2026-09-24: **rileggerlo prima di
mettersi al lavoro.**

- Questa cartella è della sessione **Predesign webapp**: solo lei la modifica e ne fa i commit; le altre chiedono
  le modifiche con un messaggio.
- Prima di modificare un file rileggerlo dal disco: un'altra sessione può averlo cambiato dopo l'ultima lettura.
- Categorie, tipi e attributi dello step Aree seguono il modello condiviso «site-features»
  (`../AGOL Axpo/schemas/site_features_model.json`, oggi 1.1.0), usato anche dal Geoportale e dal layer AGOL
  «IT - Site Features». Il modello è del **raccordo** («Allineamento Site notes, geoportal, PVPD»): una categoria,
  un tipo o un attributo nuovo si chiede a lui, poi qui si allineano `app/js/categories.js` e `app/js/i18n.js`.
- Dopo un commit o un cambio che tocca le altre sessioni: una riga nel *Registro* di COORDINAMENTO.md (o un
  messaggio al raccordo, che la scrive). Niente commit né push se l'utente non li chiede.

## Stack e struttura

- ArcGIS Maps SDK for JavaScript **4.34** caricato con `$arcgis.import()` (verificato: funziona in 4.34 ed è lo stesso
  meccanismo della 5.x, così la migrazione resta contenuta). Operatori geometrici `geometry/operators/*`, non
  `geometryEngine` (deprecato). Tutto l'accesso all'SDK passa da `app/js/sdk.js`.
- Librerie in ESM da jsDelivr: turf 6.5, xlsx 0.18.5, JSZip 3.10, @tmcw/togeojson 5.8.1 (KML), shpjs 4.0.4
  (solo lettura grezza di .shp/.dbf).
- Niente build: moduli ES nativi, più file. Serve un server http (non `file://`).
- `app/` l'applicazione (step nel rail: `terrain/` step 0 facoltativo, `areas.js` step 1, `field.js` step 2, `infra.js`
  step 3, `output.js` step 4, `quick.js` predesign rapido) ·
  `app/catalog/` toolkit, contorni dei paesi, Länder tedeschi in zona 33 · `tests/` test nel browser ·
  `docs/` piano, decisioni, `toolkit/` archivio per paese · `scripts/` server locale e generatore dei fixture ·
  `tools/` strumenti di sviluppo (test headless, lettore DWG), non parte dell'app · `backups/`.
- Stato del progetto: `store.project` (`state.js`), versione 2 con `features[]` per categoria e attributi per
  oggetto; `upgrade()` migra i progetti vecchi. File di progetto `.pvpd` (zip con `project.json`).

## Come provarla

- Server locale: voce `pv-predesign` in `.claude/launch.json` (porta 8140, serve la radice del progetto).
  App: `http://localhost:8140/app/` · Test: `/tests/` (motore, mezze tabelle), `/tests/modules.html` (roadmap,
  catalogo per paese, moduli nel progetto), `/tests/sdk.html` (SDK), `/tests/import.html` (import, sistemi di
  riferimento, area netta, round trip), `/tests/terrain.html` (step 0), `/tests/infra.html` (step 3), `/tests/ui.html` (pannelli veri su
  una vista finta). Devono essere tutti verdi prima di un commit.
- Senza browser o con i CDN bloccati (sessione cloud): `tools/headless` (`npm install && npm run build && npm test`)
  esegue tutte le pagine in Chromium headless con SDK e librerie presi da npm; GitHub Actions lo fa a ogni push
  (`.github/workflows/tests.yml`). La pagina dell'app va comunque provata
  in un browser vero (con il bundle npm la MapView non parte).
- DWG del toolkit: `tools/cad/dwg_dump.mjs` elenca testi, quote (valore misurato) e blocchi per zona del disegno.
- Le pagine di test impostano `window.__PVP_TEST__` così non sovrascrivono il progetto salvato dall'app
  (stessa origine, stesso localStorage).
- I fixture di `tests/fixtures` sono sintetici: si rigenerano con `scripts/make_fixtures.py` (Python di ArcGIS Pro,
  arcpy), che scrive anche i valori di riferimento in `expected.json`; il DTM sintetico `it_dtm_plane.tif` con
  `tools/headless/make_terrain_fixture.mjs`. **Anche codici progetto, GUID, particelle e
  nomi vanno inventati**, mai presi dal portale o da progetti veri: il 2026-09-24 un fixture portava codice e GUID
  di un'area vera di AREAS COLLECTION (e una particella forse vera), tolti riscrivendo la storia prima del primo push.
- Nel collaudo non far partire download veri: `showSaveFilePicker`/`showOpenFilePicker` finti **con**
  `createWritable`, e `HTMLAnchorElement.prototype.click` intercettato (un finto handle senza scrittura ha fatto
  scattare il download di ripiego il 2026-09-23).

## Repository

Remoto `origin` = **https://github.com/davo3188/Axpo_PV_PreDesign** (privato, creato dall'utente il 2026-09-24),
ramo `main`. Repo separata dal Geoportale per scelta dell'utente: `davo3188/custom-AGOL-web-map` è pubblica e
contiene la chiave Zornade, qui ci sono i valori interni del toolkit. Più avanti andrà spostata su un'organizzazione
aziendale (GitHub o Azure DevOps), senza perdere la storia. `gh` non è installato; il push usa le credenziali di
Git per Windows. Push solo su richiesta dell'utente; dopo il push, una riga nel Registro di COORDINAMENTO.md.

Non committare dati di progetto reali, né il toolkit (resta nella cartella AGOL Axpo / GED URBADOC): il
`.gitignore` esclude progetti, KML/KMZ, zip, Shapefile, CSV, GeoJSON, raster, DWG/DXF ed Excel, tranne i fixture
sintetici di `tests/fixtures`.
