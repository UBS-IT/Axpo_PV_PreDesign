"""Writes app/catalog/prj.json: for every coordinate system the app can export to — the national systems of
app/js/crs.js and the UTM zones of Europe (WGS 84 and ETRS89) — its ESRI WKT (the text of a Shapefile .prj, as ArcGIS
writes it), its OGC WKT 1 (the definition GeoPackage asks for) and its name. Values from the EPSG database of PROJ
through pyproj (pip install pyproj). Run: python scripts/make_prj.py
"""
import json, re, pathlib
import pyproj
from pyproj.enums import WktVersion

root = pathlib.Path(__file__).resolve().parents[1]
crs_js = (root / 'app/js/crs.js').read_text(encoding='utf-8')
codes = {int(c) for c in re.findall(r'\[(\d{4,5}),\s*[\'`]', crs_js)}
codes |= {3900 + z for z in range(42, 51)}              # RGF93 CC42-CC50 (built in a loop in crs.js)
codes |= set(range(32628, 32639)) | set(range(25828, 25839))   # UTM zones 28-38 N, WGS 84 and ETRS89
out = {'source': f'EPSG {pyproj.database.get_database_metadata("EPSG.VERSION")} via PROJ {pyproj.proj_version_str} (scripts/make_prj.py)',
       'wkt': {}, 'ogc': {}, 'name': {}}
for c in sorted(codes):
    try:
        crs = pyproj.CRS.from_epsg(c)
    except pyproj.exceptions.CRSError:
        print('not in EPSG:', c)
        continue
    out['wkt'][str(c)] = crs.to_wkt(WktVersion.WKT1_ESRI)
    out['ogc'][str(c)] = crs.to_wkt(WktVersion.WKT1_GDAL)
    out['name'][str(c)] = crs.name
(root / 'app/catalog/prj.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
print(len(out['wkt']), 'systems')
