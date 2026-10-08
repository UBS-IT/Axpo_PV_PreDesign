"""Writes the synthetic Geoportale projects of tests/fixtures that carry slopes from a DTM (the Geoportale's
«Pendenze da DTM» tool, 2026-10-04): it_slope.axpo (a steep-slope exclusion with sf_slope, the elevation grid in
terreno/<id>.f32, a DTM picture to ignore), it_slope_noterrain.axpo (the exclusion alone, as an older export) and
it_slope_partial.axpo (the grid made on a gross drawing inside a larger site of work, plus the automatic strip and
net area of the Geoportale of 2026-10-06 and a boundary setback: what a real project looks like).
Invented site, codes and GUIDs (never real ones). Plain Python with pyproj (pip install pyproj); no ArcGIS needed:
python scripts/make_axpo_slope_fixture.py

The ground is a plane rising 9 % to the east and 5 % to the north in the local frame of the gross area (the same
Transverse Mercator frame as app/js/geo/localframe.js): steepest slope 10.296 % everywhere, so a limit of 10 % in
every direction cuts every cell, and 10 % north-south with 10 % east-west cuts none.
"""
import json, math, os, struct, zipfile
import pyproj

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures')
LON0, LAT0 = 11.3021, 43.9873          # invented place in Tuscany (centre of the gross area)
HALF_W, HALF_H = 160.0, 110.0           # gross area: a 320 x 220 m rectangle centred on the frame origin
CELL, BUFFER, MIN_PATCH = 5.0, 25.0, 250
SX, SY = 0.09, 0.05                     # slope east, slope north
GRID_ID = 'g-0000-slope-test'

wkt = ('PROJCS["PV Predesign local TM",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
       'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
       'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],'
       f'PARAMETER["Central_Meridian",{LON0}],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",{LAT0}],UNIT["Meter",1.0]]')
to_ll = pyproj.Transformer.from_crs(pyproj.CRS.from_wkt(wkt), 'EPSG:4326', always_xy=True)


def ll(x, y):
    lon, lat = to_ll.transform(x, y)
    return [round(lon, 9), round(lat, 9)]


gross = {'type': 'Polygon', 'coordinates': [[ll(-HALF_W, -HALF_H), ll(HALF_W, -HALF_H), ll(HALF_W, HALF_H), ll(-HALF_W, HALF_H), ll(-HALF_W, -HALF_H)]]}
# the grid of the Geoportale: gross area plus 25 m plus one cell, from the south-west corner
margin = BUFFER + CELL
x0, y0 = -HALF_W - margin, -HALF_H - margin
nx, ny = math.ceil(2 * (HALF_W + margin) / CELL), math.ceil(2 * (HALF_H + margin) / CELL)
z = [100.0 + SX * (x0 + (i + 0.5) * CELL) + SY * (y0 + (j + 0.5) * CELL) for j in range(ny) for i in range(nx)]
limit = {'maxAny': 10}
record = {'id': GRID_ID, 'lon0': LON0, 'lat0': LAT0, 'x0': x0, 'y0': y0, 'cell': CELL, 'nx': nx, 'ny': ny,
          'zmin': min(z), 'zmax': max(z), 'missing': 0, 'loadedAt': '2026-10-04T08:00:00.000Z', 'source': 'esri', 'name': 'Esri World Elevation',
          'buffer': BUFFER, 'area_name': 'Site C0001', 'area_geom': gross, 'limit': limit, 'min_patch': MIN_PATCH,
          'view': {'visible': True, 'opacity': 0.6}, 'file': f'terreno/{GRID_ID}.f32'}
sf_slope = {'limit': limit, 'cell': CELL, 'min_patch': MIN_PATCH, 'buffer': BUFFER, 'source': 'esri', 'dtm': 'Esri World Elevation',
            'grid': GRID_ID, 'area': 'Site C0001', 'date': '2026-10-04'}
# with 10 % in every direction the whole area is over the limit: the exclusion is the gross area itself
exclusion = {'g': gross, 'v': True, 's': None,
             'a': {'_kind': 'drawing', 'geomType': 'polygon', 'nome': 'Pendenza > 10 %', 'categoria': 'Esclusione · Pendenza elevata',
                   'sf_cat': 'exclusion', 'sf_type': 'steep-slope', 'note': 'Pendenza oltre 10 % in ogni direzione (Esri World Elevation, celle 5 m)',
                   'sf_slope': sf_slope}}
site = {'guid': '{AAAAAAAA-BBBB-4CCC-8DDD-000000000002}', 'code': 'C0001', 'comune': 'Test', 'regione': 'Toscana', 'ha': None, 'geom': gross}


def write(name, with_terrain, site_of_work=site, extra_geoms=(), extra_state=None):
    project = {'formato': 'geoportale-axpo-progetto', 'versione': 1, 'nome': 'Slope test', 'site': site_of_work,
               'toolGeoms': [exclusion, *extra_geoms], 'parcels': []}
    if extra_state:
        project.update(extra_state)
    if with_terrain:
        project['terrain'] = [record]
        project['images'] = [{'name': 'DTM Esri World Elevation', 'slp': GRID_ID, 'file': None, 'corners': []}]
    with zipfile.ZipFile(os.path.join(OUT, name), 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('progetto.json', json.dumps(project, ensure_ascii=False))
        if with_terrain:
            zf.writestr(record['file'], struct.pack(f'<{len(z)}f', *z))


write('it_slope.axpo', True)
write('it_slope_noterrain.axpo', False)
# the partial case: the site of work (AREAS COLLECTION) is 500 x 300 m, the grid was made on a 320 x 220 m gross
# drawing inside it (the slope exclusion is the drawing itself); an obstacle with a buffer, its automatic strip, the
# automatic net area and a 5 m boundary setback come too
BIG_W, BIG_H = 250.0, 150.0
big = {'type': 'Polygon', 'coordinates': [[ll(-BIG_W, -BIG_H), ll(BIG_W, -BIG_H), ll(BIG_W, BIG_H), ll(-BIG_W, BIG_H), ll(-BIG_W, -BIG_H)]]}
site_big = dict(site, geom=big, code='C0002', guid='{AAAAAAAA-BBBB-4CCC-8DDD-000000000003}')
gross_drawing = {'g': gross, 'v': True, 's': None,
                 'a': {'_kind': 'drawing', 'geomType': 'polygon', 'nome': 'Site C0001', 'categoria': 'Area lorda', 'sf_cat': 'gross', 'sf_src': 'survey', 'sf_uid': 'u-gross-1'}}
oak = {'g': {'type': 'Point', 'coordinates': ll(40.0, 30.0)}, 'v': True, 's': None,
       'a': {'_kind': 'drawing', 'geomType': 'point', 'nome': 'Oak', 'categoria': 'Ostacolo · Albero', 'sf_cat': 'obstacle', 'sf_type': 'tree', 'sf_height': 10, 'sf_buffer': 8, 'sf_uid': 'u-oak-1'}}
strip = {'g': {'type': 'Polygon', 'coordinates': [[ll(32.0, 22.0), ll(48.0, 22.0), ll(48.0, 38.0), ll(32.0, 38.0), ll(32.0, 22.0)]]}, 'v': True, 's': None,
         'a': {'_kind': 'drawing', 'geomType': 'polygon', 'nome': 'Fascia 8 m · Oak', 'categoria': 'Esclusione · Fascia di rispetto', 'sf_cat': 'exclusion', 'sf_type': 'setback',
               'sf_src': 'geoprocess', 'sf_auto': 'buffer', 'sf_of': 'u-oak-1', 'sf_sig': 'x', 'note': 'automatica: segue «Oak» e il suo buffer'}}
net = {'g': {'type': 'Polygon', 'coordinates': [[ll(-155.0, -105.0), ll(155.0, -105.0), ll(155.0, 105.0), ll(-155.0, 105.0), ll(-155.0, -105.0)]]}, 'v': True, 's': None,
       'a': {'_kind': 'drawing', 'geomType': 'polygon', 'nome': 'Area netta · 6,50 ha', 'categoria': 'Area netta', 'sf_cat': 'net', 'sf_src': 'geoprocess', 'sf_auto': 'net', 'sf_sig': 'y',
             'note': 'automatica: lorda 7,04 ha − rientro dal confine 5 m − 1 area che taglia'}}
write('it_slope_partial.axpo', True, site_of_work=site_big, extra_geoms=(gross_drawing, oak, strip, net), extra_state={'netAuto': True, 'netSetback': 5})
exp_path = os.path.join(OUT, 'expected.json')
with open(exp_path, encoding='utf-8') as fh:
    expected = json.load(fh)
expected['it_slope'] = {'grid': GRID_ID, 'nx': nx, 'ny': ny, 'cell': CELL, 'slopeEast': SX, 'slopeNorth': SY,
                        'steepest': round(math.hypot(SX, SY) * 100, 3), 'limit': limit, 'min_patch': MIN_PATCH, 'gross_m2': 4 * HALF_W * HALF_H,
                        'partial': {'site_m2': 4 * BIG_W * BIG_H, 'grid_m2': (nx * CELL) * (ny * CELL), 'setback': 5, 'auto': 2}}
with open(exp_path, 'w', encoding='utf-8', newline='\n') as fh:
    json.dump(expected, fh, indent=1)
print('written: it_slope.axpo, it_slope_noterrain.axpo, it_slope_partial.axpo;', nx, 'x', ny, 'cells, steepest', expected['it_slope']['steepest'], '%')
