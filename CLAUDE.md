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
   si scrive lì con fonte e stato (confirmed / verify / open), poi passa nel catalogo quando serve all'app.
   **Il catalogo si modifica dal workbook `docs/toolkit/toolkit.xlsx`** (fogli Values e record), poi
   `python scripts/make_toolkit.py` rigenera il JSON; la CI verifica che coincidano (`--check`). Se si tocca il JSON
   direttamente, `--export` riallinea il workbook. Valori di
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
5. **Modifiche rischiose**: lavorare su un branch dedicato, rileggere i file prima di modificarli, verificare
   `git diff`/test e conservare una via di ripristino. Non presupporre che `backups/` o una cartella sorella
   `../AGOL Axpo/` esistano in ogni clone; non committare backup o dati reali nel repository.
6. **Parte elettrica**: volutamente aperta (l'utente raccoglie le informazioni, ~6 mesi). Non inventarla.
7. **Resa**: lo Yield tool interno esporrà un'API (non ancora disponibile). Fino ad allora kWh/kWp inseriti a mano.
8. **Predesign veloce e intuitivo** (utente, 2026-09-25): più accurato del solito, ma rapido. Le regole del toolkit
   sono default e suggerimenti, mai vincoli rigidi: il progettista decide (es. strada perimetrale proposta fino a
   ~9 MWp, non imposta). Le opzioni avanzate restano facoltative e non devono appesantire il percorso base.

## Coordinamento tra sessioni e clone

Se disponibile, `../AGOL Axpo/COORDINAMENTO.md` raccoglie stato, proprietà dei file e richieste delle altre
sessioni: leggerlo e aggiornare il Registro per cambi che le coinvolgono. Il normale clone Git della webapp è
standalone e può non contenere la cartella sorella; in tal caso non bloccare il lavoro né creare un registro fittizio.

- Lavora in un branch dedicato; non modificare file su cui sta lavorando un'altra sessione senza coordinarla.
- Prima di modificare un file rileggerlo dal disco e controllare `git status --short`: il clone locale può essere
  cambiato dopo l'ultima lettura.
- Categorie, tipi e attributi dello step Aree seguono il modello condiviso «site-features»
  (`../AGOL Axpo/schemas/site_features_model.json` nel workspace condiviso, modello 1.1.0 alla data del 2026-09-28),
  usato anche dal Geoportale e dal layer AGOL «IT - Site Features». Se un cambio tocca il modello, coordinare
  l'aggiornamento di `app/js/categories.js` e `app/js/i18n.js` con il referente del raccordo.
- Non fare commit, push o merge se l'utente non li ha richiesti. Se il Registro non è accessibile, comunicare le
  modifiche al referente senza assumere di averlo aggiornato.

## Stack e struttura

- ArcGIS Maps SDK for JavaScript **4.34** caricato con `$arcgis.import()` (verificato: funziona in 4.34 ed è lo stesso
  meccanismo della 5.x, così la migrazione resta contenuta). Operatori geometrici `geometry/operators/*`, non
  `geometryEngine` (deprecato). Tutto l'accesso all'SDK passa da `app/js/sdk.js`.
- Librerie servite dall'app in `app/vendor/` (moduli ES minificati, versioni fissate in `tools/headless/package-lock.json`,
  rigenerati con `npm run vendor`; la CI controlla che coincidano), caricate solo da `app/js/libs.js`: JSZip 3.10.1,
  @tmcw/togeojson 5.8.1 (KML), shpjs 4.0.4 (solo lettura grezza di .shp/.dbf), geotiff 2.1.3 (DTM), jsPDF 4.2.1
  (report), sql.js 1.13.0 (SQLite in WebAssembly, con il suo `.wasm`: GeoPackage). Excel (.xlsx/.xlsm) letto da `app/js/io/xlsx.js` (JSZip + DOMParser, niente SheetJS: la 0.18.5 di npm ha
  falle note), CSV da `app/js/io/csv.js` (RFC 4180). Solo l'SDK ArcGIS arriva da CDN (js.arcgis.com).
- Niente build: moduli ES nativi, più file. Serve un server http (non `file://`).
- `app/` l'applicazione (step nel rail, uno stepper con stati locked / ready / optional / done forniti dai pannelli
  con `stepProvider` di `ui/rail.js`: `areas.js` 1 · Site (disegno a due passi come il *Disegna* del Geoportale, undo/redo),
  `terrain/` 2 · Terrain facoltativo, `field.js` 3 · Layout, `infra.js` 4 · Infrastructure, `output.js` 5 · Outputs con
  `export/` per Engineering: Shapefile, GeoPackage, DXF R12, computo Excel nel sistema nazionale
  (niente .gdb: deciso dall'utente il 2026-09-28),
  `.prj` da `app/catalog/prj.json` generato da `scripts/make_prj.py`; `quick.js` predesign rapido; `view3d/` 3D come
  interruttore 2D/3D sulla mappa, non uno step (deciso il 2026-10-02): SceneView sulla stessa mappa, altezze dal toolkit del paese,
  sole NOAA verificato con pvlib, glTF). Niente `confirm()` nativi: `ui/dialog.js` per le conferme, toast con «Undo» per
  le rimozioni. Decisioni UX del 2026-10-02 in `docs/decisions.md` e `docs/audit/` ·
  `app/catalog/` toolkit, contorni dei paesi, Länder tedeschi in zona 33 · `tests/` test nel browser ·
  `docs/` piano, decisioni, `toolkit/` archivio per paese · `scripts/` server locale e generatore dei fixture ·
  `tools/` strumenti di sviluppo (test headless, lettore DWG), non parte dell'app. Un eventuale `backups/` è
  locale al workspace, non un prerequisito del clone.
- Stato del progetto: `store.project` (`state.js`), versione 2 con `features[]` per categoria e attributi per
  oggetto; `upgrade()` migra i progetti vecchi. File di progetto `.pvpd` (zip con `project.json`).

## Come provarla

- Server locale: voce `pv-predesign` in `.claude/launch.json` (porta 8140, serve la radice del progetto).
  App: `http://localhost:8140/app/` · Test: `/tests/` (motore, mezze tabelle), `/tests/modules.html` (roadmap,
  catalogo per paese, moduli nel progetto), `/tests/sdk.html` (SDK), `/tests/import.html` (import, sistemi di
  riferimento, area netta, round trip), `/tests/terrain.html` (step 2), `/tests/infra.html` (step 4), `/tests/view3d.html` (3D), `/tests/scene3d.html` (SceneView vera, WebGL software in headless), `/tests/ui.html` (pannelli veri su
  una vista finta). Devono essere tutti verdi prima di un commit.
- Senza browser o con js.arcgis.com bloccato (sessione cloud): da `tools/headless`, eseguire
  `npm ci && npm run build && npm test`. Il runner esegue le pagine di test in Chromium headless con l'SDK npm;
  GitHub Actions esegue la suite a ogni push e pull request (`.github/workflows/tests.yml`). **Il runner attuale
  stampa gli errori browser ma non fallisce per essi**: prima di fidarsi del solo segno verde in CI, controllare
  anche log e console. La pagina reale `/app/` non fa parte della suite headless: provarla in un browser vero,
  sulla rete aziendale di destinazione, con un sito campione e passaggio 2D → 3D → 2D.
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

## Stato e criteri per il rilascio (2026-09-28)

La correzione dell'altezza interna di SceneView è in `main` (PR #10); il controllo 3D nel browser dell'utente
ha dato 5/5. Gli step 0–4b sono implementati, ma questo significa **candidato a pilot interno, non approvazione
per la produzione**. Non reintrodurre la forzatura di `SceneView.spatialReference` usata in una patch di prova:
nel test la scena restava in 4326; il fixture 3D ora usa una basemap sintetica Web Mercator, mentre la scelta del CRS
nazionale resta per import/export. L'SDK ArcGIS è caricato dal CDN nella pagina dell'app, non dal bundle dei test.

Prima di proporre un rollout:

1. **P0 — input non affidabili**: validare i `.pvpd` e gli ID di feature, moduli e viste prima di inserirli nel DOM;
   non interpolare ID importati in attributi HTML senza escaping. Aggiungere casi di file malformati e ostili.
2. **P0 — integrità progetto**: grid `terrain/grid.f32` mancante o incoerente non deve dare un «salvato/aperto»
   apparentemente riuscito; segnalare i fallimenti di `localStorage`/IndexedDB e provare round trip su un browser
   nuovo. Non presentare l'autosave come backup garantito.
3. **P1 — qualità del gate**: far fallire il CI per errori browser inattesi; provare cambio/sostituzione del DTM
   durante la scena e mettere timeout con errore comprensibile a screenshot e report 3D.
4. **Validazione applicativa**: confrontare area edificabile, tavoli e MWp con un sito italiano già progettato da
   Engineering; concordare tolleranze. Le fixture sintetiche non dimostrano la qualità delle stime reali.
5. **Messa in esercizio**: definire hosting, controllo accessi, condizioni/licenze e credenziali ArcGIS per i
   servizi Esri, trattamento dei dati di sito, backup/ripristino e responsabile dei toolkit nazionali.

Le priorità sopra descrivono interventi **da fare**, non funzionalità già corrette: mantenere questo stato
coerente con `README.md` e `docs/plan.md` man mano che si chiudono. Conservare l'indicazione di fonte e stato
(`confirmed`/`verify`/`open`) per ogni regola: non sostituire dati mancanti con valori di un altro Paese.

## Repository

Remoto `origin` = **https://github.com/davo3188/Axpo_PV_PreDesign** (privato, creato dall'utente il 2026-09-24),
ramo `main`. Repo separata dal Geoportale per scelta dell'utente: `davo3188/custom-AGOL-web-map` è pubblica e
contiene la chiave Zornade, qui ci sono i valori interni del toolkit. Più avanti andrà spostata su un'organizzazione
aziendale (GitHub o Azure DevOps), senza perdere la storia. `gh` non è installato; il push usa le credenziali di
Git per Windows. Push solo su richiesta dell'utente; dopo un push che riguarda gli altri progetti, aggiornare
`COORDINAMENTO.md` se disponibile oppure avvisare il referente.

Non committare dati di progetto reali, né il toolkit (resta nella cartella AGOL Axpo / GED URBADOC): il
`.gitignore` esclude progetti, KML/KMZ, zip, Shapefile, CSV, GeoJSON, raster, DWG/DXF ed Excel, tranne i fixture
sintetici di `tests/fixtures`.
