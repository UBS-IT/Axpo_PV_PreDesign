# Italy

Sources (received 2026-09-25, see `sources.md`):
- **IT-PC PDF** — `Toolkit_PC_Ground_Mounting_IT - Standard.pdf`, one A3 sheet «Italia».
- **IT-PC DWG** — `Toolkit_PC_CS_IT.dwg` (AutoCAD 2018): the same panels and more (fixed-structure sections at 25°
  and 29°, tracker variants, north–south road). Dimensions read as measured values with `tools/cad/dwg_dump.mjs`;
  drawing units are metres.

Status: **confirmed** = written on the sheet · **verify** = measured on the drawing or interpreted · **open** = asked.

## Fixed structures

Module TOPCon 132c M10 bifacial 2.382 × 1.134 m (30 mm). Sections «T 15° / AO 29° SUD» (current) and an «old
version» at AO 25°. Supports: vertical piles or concrete footing (shape and number of piles indicative only).

| Item | Value | Source | Status |
|---|---|---|---|
| Tilt | 15° | IT-PC | confirmed |
| **Shading angle (AO)** | **29°** (old version 25°) | IT-PC DWG, section titles «T 15°/AO 29° SUD» | confirmed (reading of «AO» as *angolo d'ombra*: the pitches below match it exactly) |
| Pitch | «interasse variabile da adattare secondo le indicazioni del progettista» | IT-PC | confirmed |
| Pitch at AO 29° | 2V: 6.85 m (4.62 + 2.23) · 3V: 10.30 m (6.94 + 3.36) | IT-PC DWG | confirmed; the app formula `D cos t + D sin t / tan AO` gives 6.855 and 10.297 |
| Pitch at AO 25° (old) | 2V: 4.62 + 2.66 · 3V: 6.94 + 3.99 | IT-PC DWG | confirmed |
| Gap between tables | 0.30 m | IT-PC DWG | confirmed |
| Gap between modules | 0.02 m | IT-PC DWG | confirmed |
| Ground clearance (low edge) | 1.00 m | IT-PC DWG (dimension 1.00 under the section), USER 2026-09-25 | confirmed |
| Structures drawn | 2V13 (14.98), 2V14 (16.14), 2V26 (29.98), 2V28 (32.29), 3V8 (9.21), 3V9 (10.37), 3V16 (18.44), 3V18 (20.75) — lengths in m | IT-PC DWG | confirmed; all equal `n × 1.134 + (n − 1) × 0.02` (2V26 / 2V28 = two tables with a 0.50 m joint) |

## Trackers 1V

| Item | Value | Source | Status |
|---|---|---|---|
| Type | 1 module portrait, single row, east–west tracking, north–south axis | IT-PC | confirmed |
| Variants drawn | 1V27 / 1V54 (sheet), 1V26 / 1V52 and 1V28 / 1V56 (DWG) | IT-PC | confirmed — the group standard is **1V28** (`group.md`) |
| Rotation | ±55° | IT-PC | confirmed |
| Pitch | 6.00 m or 5.50 m in the drawings (free space 3.62 / 3.12 m) | IT-PC | examples: the pitch is agreed with the farm |
| Heights | h min at max rotation 0.50 m (agroPV standard) · 1.30 m (grazing) · 2.10 m (advanced agroPV); axis at 1.50 / 2.30 / 3.10 m; top at 2.50 / 3.30 / 4.10 m | IT-PC | confirmed — in the catalog as `tracker.axisHeights`; the 3D view uses the standard category unless the designer picks another (USER 2026-09-28) |
| Length of a 1V27 | **32.33 m** (27 modules = 31.14 m + **1.19 m** drive / motor gap) | IT-PC DWG, block extents | confirmed; the 1V28 is 33.48 m with the same gap (USER) |
| Gap between trackers in line | 0.50 m («distanza tra due stringhe contigue») | IT-PC | confirmed |
| Trackers in line | **4 at most**, then a 4.00 m gap | IT-PC DWG, panel «distanza tra strada nord-sud e trackers 1V27» (130.81 m = 4 × 32.33 + 3 × 0.50) | confirmed |
| Slope | up to 15 % in every direction | IT-PC | confirmed |

## Roads and clearances

| Item | Value | Source | Status |
|---|---|---|---|
| Light internal traffic | road 3 m wide | IT-PC | confirmed |
| Heavy internal traffic | road 3 m or **4 m** (4 m and R12 for trucks) | IT-PC | confirmed |
| Bends | inner radius 12 m, outer 17 m, 1 m widening on each side | IT-PC | confirmed |
| Site entrance | turning radius 12 m from the public road, 1 m widening | IT-PC | confirmed |
| Road section | road, ditch, buffer, PV field (section A-A) | IT-PC | drawing only |
| Fence → structures, **with** perimeter road | 1 m + 4 m road + 1 m = **6 m** | IT-PC DWG | confirmed (fixed and trackers) |
| Fence → structures, **without** perimeter road | **4 m** | IT-PC DWG | confirmed (fixed and trackers) |
| Green strip → structures | 4 m; strip width and strip → fence «variabile» | IT-PC DWG | confirmed |
| North–south road → tracker ends | 4 m road + 2 m | IT-PC DWG | confirmed |
| Road between two blocks with a transformer station | 2 m + 4 m road + 3 m (station side), station 1 m off the road | IT-PC DWG | confirmed |
| Station position | on the **south side** of the road; align the structures with the farthest one | IT-PC | confirmed |
| Perimeter road | template preferred up to about 9 MWp, the designer decides | USER (`group.md`) | confirmed |

## Stations (concrete; size to be checked for each project)

| Station | Plan (m) | Area | Height | With embankment | Source | Status |
|---|---|---|---|---|---|---|
| Transformer (CT) — power not defined | 8.70 × 3.00 (8.80 × 3.05 at the roof) | 26.1 m² | 3.50 + 0.60 below ground | 13.10 × 7.40 | IT-PC | confirmed |
| Delivery (CC) | 7.50 × 3.00 (7.55 × 3.05) | 22.5 m² | 3.21 + 0.60 | 11.90 × 7.40 | IT-PC | confirmed |
| User (CU) — at most **20 m** from the delivery station | 7.50 × 3.00 (7.55 × 3.05) | 22.5 m² | 3.21 + 0.60 | 11.90 × 7.40 | IT-PC | confirmed |

Unloading area (crane 44 t / 22 t, radii R6 / R12): a 12.00 m zone along the road (overall 12.00 × 8.00 m with the
road side, 1.00 m margins); around the station 3.00 m behind and on the side and 1.00 m to the road are not to be
covered by modules. Source IT-PC — overall dimensions **verify**.

## Fence, gates, cameras

| Item | Value | Source | Status |
|---|---|---|---|
| Fence | 2.00 m, welded mesh 50/50 galvanised (or plastic-coated, RAL to define), steel or wooden posts about every 2.5 m; variant mesh 100/50 grey; wildlife passages | IT-PC | confirmed |
| Gate | two swing leaves, vertical bars, **6.00 m** («da definirsi secondo progetto»), 2.00 m high, RAL 6005 | IT-PC | confirmed |
| Cameras | fixed camera 3.00 m, dome camera 6.00 m (may be lower with planning constraints) | IT-PC DWG | verify |

## Open questions

- Overall size of the unloading area.
