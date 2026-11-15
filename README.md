# Excavation Coordination GIS Engine

A full-stack GIS platform for coordinating street excavation works between utility agencies and the city, built around Jeddah, Saudi Arabia.

Water, electricity and telecom companies keep digging up the same streets. In this platform an agency draws its planned excavation route on an interactive map. Before anyone reviews the request, the system checks it automatically:

- **Space-and-time conflicts** with other excavations. For each conflict it suggests a **"dig-once"** window, so the street is dug and repaved only once.
- **Recently paved roads**: a warning when the works cross a road paved in the last 12 months.
- **Sensitive sites**: schools and hospitals within 50 m of the route.
- **Accurate measurements**: length and area on the Earth's ellipsoid, not on the flat map.
- **Data-quality checks**: valid geometry, inside the city boundary, sane coordinates (UTM numbers typed as degrees are detected), and valid dates and width.

A municipal reviewer then sees every request on the map. The reviewer opens one, sees its live conflicts and approves or rejects it.

> This is a prototype of the GIS engine behind such a coordination workflow. It is not affiliated with any official system.

**Stack:**
- **Angular 20** with the **ArcGIS Maps SDK for JavaScript 5.1**
- **ASP.NET Core Web API (.NET 10)**
- **Oracle Database 26ai Free** with **Oracle Spatial**
- JWT role-based auth, xUnit tests, Swagger UI

---

## Features

| Area | What it does |
| --- | --- |
| Draw and submit | Draw the route as a polyline on the map (ArcGIS Sketch), or paste UTM Zone 37N coordinates that are converted to WGS84. Then set the width, dates and work type. |
| Live preview | While you draw, the browser shows length, the buffered excavation area and its area. Nothing is sent to the server. |
| Server analysis | Oracle Spatial buffers the route by width/2 and computes geodesic length and area. It then finds conflicts in space and time, with the overlap polygon, overlap area and overlap days. It also checks paved roads, sensitive sites within 50 m, and the city boundary. |
| Dig-once | For each conflict it proposes a shared window that keeps the applicant's duration and is aligned with the other agency's start. |
| Review | A list and a map coloured by status, with status and agency filters. Opening a request recomputes its conflicts. The reviewer can approve, or reject with a required reason. |
| ArcGIS services | A Map Service (MapServer) reference layer and a Feature Service (hosted layer) shown as a `FeatureLayer`. The backend syncs that layer into Oracle through the ArcGIS REST API. |
| Security | JWT with `Applicant` and `Reviewer` roles, enforced on API endpoints and on Angular routes. |
| Map key | An always-visible, collapsible legend that explains every line, colour and point. The side panel can be collapsed to free the whole map. |

---

## Architecture

```
 ┌──────────────────────────── Browser (http://localhost:4200) ────────────────────────────┐
 │  Angular 20 (standalone components, signals, RTL Arabic UI)                             │
 │   login ─► JWT ─► HTTP interceptor (Bearer) ─► role guards (/applicant, /reviewer)       │
 │                                                                                          │
 │  ArcGIS Maps SDK 5.1 — MapView (OpenStreetMap basemap)                                   │
 │   ├─ TileLayer     ◄── ArcGIS MapServer (World Transportation reference)                │
 │   ├─ FeatureLayer  ◄── ArcGIS FeatureServer (hosted sensitive sites, optional)          │
 │   ├─ API layers: city boundary, paved roads, sites, excavations (UniqueValueRenderer)   │
 │   ├─ SketchViewModel (polyline) · projectOperator: UTM 37N (32637) ─► WGS84 (4326)      │
 │   └─ client preview: geodeticLength / geodesicBuffer / geodeticArea operators           │
 └─────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ REST + JSON (GeoJSON geometries, lon/lat)
 ┌─────────────────────────────────────────▼────────────────────────────────────────────────┐
 │  ASP.NET Core Web API (.NET 10) — http://localhost:5106 — Swagger UI at /swagger        │
 │   Controllers: Auth · Excavations · Layers · Integration   [Authorize(Roles = …)]       │
 │   Domain (pure C#, unit-tested): DateRange · DigOncePlanner · RequestValidator ·        │
 │                                  WktBuilder                                             │
 │   AnalysisService: validation ─► Oracle spatial SQL ─► dig-once ─► AnalysisResult        │
 │   ArcGisSyncService: HttpClient ─► {layer}/query?where=1=1&outFields=*&f=geojson         │
 │   Plain ADO.NET (ODP.NET) · RFC 7807 ProblemDetails · CORS                              │
 └─────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ ODP.NET (localhost:1521/FREEPDB1, schema EXCAV)
 ┌─────────────────────────────────────────▼────────────────────────────────────────────────┐
 │  Oracle 26ai Free + Oracle Spatial — SDO_GEOMETRY, SRID 4326, tolerance 0.05 m          │
 │   excavations(route_geom, area_geom) · sensitive_sites · paved_roads · city_boundary     │
 │   MDSYS.SPATIAL_INDEX_V2 on every geometry column, B-tree indexes on dates and status   │
 │   SDO_BUFFER · SDO_RELATE · SDO_WITHIN_DISTANCE · SDO_INTERSECTION · SDO_LENGTH/AREA     │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
       ▲ one-time seed: OpenStreetMap (Overpass API) ─► data/osm/*.geojson ─► 02_seed.sql
```

---

## Getting started

### Prerequisites

| Tool | Version |
| --- | --- |
| .NET SDK | 10.x |
| Node.js / npm | 24 / 11 (Angular CLI 20) |
| Oracle | Oracle Database 26ai Free, PDB `FREEPDB1` on `localhost:1521`, with `sqlplus` on the PATH |

No ArcGIS API key is needed for the basic setup: the basemap is OpenStreetMap and the MapServer layer is public.

### 1. Database

One script does the whole setup. It asks for two passwords, both hidden: the SYSTEM password, and a new password for the `EXCAV` schema. Then it:

1. creates the `EXCAV` user;
2. creates the tables, spatial metadata and spatial indexes;
3. loads the seed data and runs validation queries;
4. stores the API connection string and a random JWT signing key in `dotnet user-secrets`, so no secret is ever written into the repository.

```bat
powershell -ExecutionPolicy Bypass -File database\setup-db.ps1
```

To drop the schema and rebuild it from scratch:

```bat
powershell -ExecutionPolicy Bypass -File database\setup-db.ps1 -Reset
```

<details><summary>Manual setup (SQL*Plus)</summary>

Run `set NLS_LANG=AMERICAN_AMERICA.AL32UTF8` first, so the Arabic text is stored correctly.

```bat
sqlplus system@localhost:1521/FREEPDB1 @database\00_create_user.sql
sqlplus excav@localhost:1521/FREEPDB1 @database\01_schema.sql
sqlplus excav@localhost:1521/FREEPDB1 @database\02_seed.sql

cd backend\ExcavationApi
dotnet user-secrets set "ConnectionStrings:Oracle" "User Id=excav;Password=<password>;Data Source=localhost:1521/FREEPDB1;"
dotnet user-secrets set "Jwt:Key" "<random string, 64+ characters>"
```
</details>

### 2. Backend

```bat
cd backend\ExcavationApi
dotnet run --launch-profile http
```

Swagger UI opens at http://localhost:5106/swagger. Click **Authorize** and paste the token returned by `POST /api/auth/login`.

### 3. Tests

```bat
cd backend
dotnet test
```

The xUnit tests cover the pure domain logic: date-range overlap, dig-once planning, request validation, WKT building under different cultures, and ArcGIS feature mapping. They don't need a database.

### 4. Frontend

```bat
cd frontend
npm install
npm start
```

Then open http://localhost:4200.

### Development users

At startup, in Development only, the API creates these users with PBKDF2-hashed passwords:

| Username | Password | Role | Agency |
| --- | --- | --- | --- |
| `stc` | `Stc@12345` | Applicant | STC (telecom) |
| `nwc` | `Nwc@12345` | Applicant | NWC (water) |
| `reviewer` | `Review@12345` | Reviewer | — |

---

## Walkthrough

1. **Log in as `stc`.** Open the layer list to switch layers on and off, and see the map key at the bottom left.
2. **Get a route.** Draw one with **ارسم مسار الحفر**, or click **تحميل مسار مثال** to load a sample route on Khalid bin Al-Walid Street. The live preview shows the length and the excavation area.
3. **Set the request.** Width **1.5 m**, dates **2026-12-01 → 2026-12-15**. Then click **تحليل**. The analysis shows:
   - a conflict with an approved water pipeline (6 overlapping days), drawn in red, with a dig-once suggestion;
   - a recently-paved-road warning;
   - a hospital and a school within 50 m.
4. **Click تقديم الطلب.** The request is saved as *Pending*.
5. **Log in as `reviewer`.** Open the new request: its conflicts are recomputed. Approve it, or reject it with a reason.

**UTM input:** on the **إدخال إحداثيات UTM** tab, click **مثال** to fill the same route in UTM Zone 37N. It is converted to WGS84 in the browser.

**Swagger:** the same sample request body is in `data/demo_route.json`. Use it with `POST /api/excavations/analyze`.

### Sample data

All the requests are sample data (بيانات تجريبية). Their routes are real streets from OpenStreetMap.

| Agency | Status | Street | Purpose |
| --- | --- | --- | --- |
| NWC water pipeline | Approved | شارع خالد بن الوليد | The sample route conflicts with it |
| SEC electric cable | Pending | طريق فلسطين | A pending request that already has a conflict… |
| AMANA road works | Approved | طريق فلسطين | …with this one: 3 days, about 300 m² |
| NWC sewage pipeline | Rejected | Ali Al-Murtada St. | A rejected request, with its reason |
| NWC sewage pipeline | Pending | Ali Al-Murtada St. | Re-submission of the rejected request: shorter route and shorter window |

Rejected requests never count as conflicts, because they will not be dug.

---

## GIS concepts and where they are used

| Concept | Where |
| --- | --- |
| `SDO_GEOMETRY` in SRID 4326 (geodetic), so distances and areas are in metres on the ellipsoid | `database/01_schema.sql` |
| Spatial metadata (`USER_SDO_GEOM_METADATA`) and `MDSYS.SPATIAL_INDEX_V2` indexes | `database/01_schema.sql` |
| Buffer analysis: `SDO_BUFFER` turns the route into the excavation polygon | `Services/AnalysisService.cs` |
| Geodesic measurements: `SDO_LENGTH` and `SDO_AREA` | `Services/AnalysisService.cs` |
| Geometry validation: `VALIDATE_GEOMETRY_WITH_CONTEXT` | `Services/AnalysisService.cs` |
| Containment in the city boundary: `SDO_RELATE` with `mask=CONTAINS+COVERS` | `Services/AnalysisService.cs` |
| Spatio-temporal conflicts: `SDO_RELATE` with `mask=ANYINTERACT`, plus date overlap | `Services/AnalysisService.cs`, `database/queries/analyze_examples.sql` |
| Overlap polygon and area: `SDO_INTERSECTION` | `Services/AnalysisService.cs` |
| Proximity: `SDO_WITHIN_DISTANCE` and `SDO_DISTANCE` (50 m) | `Services/AnalysisService.cs` |
| Query plans: `EXPLAIN PLAN` showing the domain index `EXCAV_AREA_SIDX` | `database/queries/explain_plan.sql` |
| ArcGIS Map Service: `TileLayer` | `frontend/src/app/shared/map/map.component.ts` |
| ArcGIS Feature Service: `FeatureLayer(url)` | `map.component.ts` |
| ArcGIS REST API sync, upserting by `external_id` | `Services/ArcGisSyncService.cs` |
| Client-side `FeatureLayer` with a `UniqueValueRenderer` by status | `map.component.ts` |
| Sketching polylines: `SketchViewModel` | `features/applicant/applicant.component.ts` |
| Geodesic vs planar (Web Mercator) length, geodesic buffer and area | `gis/geometry-tools.ts` |
| Coordinate transformation from UTM 37N (EPSG:32637) to WGS84 with `projectOperator` | `gis/geometry-tools.ts` |
| Ring orientation: GeoJSON/Oracle rings are counter-clockwise, Esri rings are clockwise; converted with the shoelace rule | `gis/geojson-esri.ts` |
| Topology-safe Douglas–Peucker simplification of the city boundary | `data/scripts/generate-seed.mjs` |

---

## API

| Method | Route | Role |
| --- | --- | --- |
| POST | `/api/auth/login` | anonymous |
| GET | `/api/agencies` | authenticated |
| POST | `/api/excavations/analyze` | Applicant, Reviewer (does not save) |
| POST | `/api/excavations` | Applicant (re-analyses; 201 if valid, otherwise 400 ProblemDetails) |
| GET | `/api/excavations?status=&agencyId=` | authenticated |
| GET | `/api/excavations/{id}` | authenticated (includes the current conflicts) |
| POST | `/api/excavations/{id}/approve` | Reviewer |
| POST | `/api/excavations/{id}/reject` | Reviewer (reason required) |
| GET | `/api/layers/sensitive-sites` · `/paved-roads` · `/city-boundary` | authenticated (GeoJSON) |
| POST | `/api/integration/arcgis/sync-sensitive-sites` | Reviewer |

Errors are returned as RFC 7807 ProblemDetails, without stack traces or SQL. CORS allows only the Angular dev origin.

---

## ArcGIS Feature Service (optional)

The seed data already contains the sensitive sites, so everything works without ArcGIS. To serve them from your own hosted layer:

1. Publish `data/sensitive_sites.geojson` as a hosted feature layer in ArcGIS Online or ArcGIS Location Platform.
2. If the layer is private, create an API key with access to that item only.
3. Store the layer URL, and the key if needed. The key is read hidden. It goes into user-secrets and into the git-ignored `frontend/public/config.local.json`.

   ```bat
   powershell -ExecutionPolicy Bypass -File database\set-arcgis.ps1 -LayerUrl "https://services….arcgis.com/<org>/arcgis/rest/services/<name>/FeatureServer/0"
   ```

4. Restart the API and the frontend.

The map then shows the hosted `FeatureLayer`. The reviewer's sync button pulls the layer with `GET {layer}/query?where=1=1&outFields=*&outSR=4326&f=geojson` and upserts it into Oracle by `external_id`. The API key is sent in the `X-Esri-Authorization` header, never in the URL.

---

## Data

Every real-world geometry comes from **OpenStreetMap** through the Overpass API. It is cached in `data/osm/`, and the seed SQL is generated from it:

```bat
node data\scripts\fetch-osm.mjs
node data\scripts\generate-seed.mjs
```

`fetch-osm.mjs` refetches only when needed (pass `--force` to ignore the cache). `generate-seed.mjs` writes `database/02_seed.sql`, `data/sensitive_sites.geojson` and the sample route.

| Data | Source |
| --- | --- |
| City boundary | OSM relation **محافظة جدة** (admin_level 6). It is simplified to about 400 vertices with no self-intersections, and its exterior ring is counter-clockwise. |
| Sample street | **شارع خالد بن الوليد**: one carriageway from four OSM ways |
| Sensitive sites | Named OSM schools and hospitals within 300 m of the sample street |
| Other sample requests | Segments of **طريق فلسطين** and **Ali Al-Murtada St.** |

The excavation requests, their dates and statuses, and the paving date are sample values.

**Note on the reference layer:** the ArcGIS World Transportation layer is hidden by default. Its street labels come from another provider and can be out of date. For example, it still shows streets in areas of Jeddah that have since been cleared.

---

## Project structure

```
database/   00_create_user · 01_schema · 02_seed (generated) · 99_drop_all
            setup-db.ps1 · run-sql.ps1 · set-arcgis.ps1
            queries/analyze_examples.sql · queries/explain_plan.sql
data/       scripts/fetch-osm.mjs · scripts/generate-seed.mjs · osm/ · sensitive_sites.geojson
backend/    ExcavationGis.sln
            ExcavationApi/ (Controllers, Domain, Data, Services, Contracts, Infrastructure)
            ExcavationApi.Tests/
frontend/   Angular 20: core/ (auth, API) · gis/ (conversion, geometry tools)
            shared/map · features/{login, applicant, reviewer}
```

---

Map data © OpenStreetMap contributors (ODbL). Esri basemaps and services © Esri and its data providers.
