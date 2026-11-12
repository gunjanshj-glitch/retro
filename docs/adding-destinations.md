# Adding a new destination

How to put a place the catalogue has never heard of (worked example: **Koh Samui**, Thailand) into the quote engine. Everything here is grounded in the ETL under [`scripts/etl/`](../scripts/etl). Background on the model is in [quotation-engine.md](./quotation-engine.md).

Nothing is edited in the app. You change source files, run `npm run build-atlas`, and the compiled bundles in `public/atlas/` pick the place up. Quoting is client-side over those bundles, so a place is live as soon as a new build is deployed.

## What a place is made of

| Layer | Source file | Required? | If missing |
| --- | --- | --- | --- |
| Identity (region, country, name) | `input_files/travel_agency_dataset.json` | **Yes** | The place does not exist. Nothing else is read for it. |
| Map pin and coordinate | `content/destinations/<region>.json` `map.markers[]` | Strongly recommended | Falls back to the airport, then the geocoder. |
| Destination knowledge | `input_files/Destination Files markdown/**/<Place>.md` | Recommended | Generic day plan: no attractions, seasonality or suitability scores. |
| Transport routes | `input_files/transport_json_regions/<region>_transport.json`, or the transport patch overlay (`content/transport-patch.json`) | Recommended | No authored leg. Distance is still measured from coordinates, but there is no fare range, terminals or mode list. |
| Contracted rates | `input_files/Pricing_Rules.xlsx`, one sheet named after the place | Optional | Hotel, transfer and meal rates are estimated (`source: "estimated"`). |
| Name fixes | `content/place-aliases.json`, `content/place-countries.json` | Only if needed | See below. |

## Minimum viable edits

I ran these on a throwaway copy of the repo (see the last section).

### 1. Master catalogue

In `input_files/travel_agency_dataset.json`, add the name to its country's `places` array. The name string is the join key for everything else, so choose one spelling and use it everywhere.

```json
{ "country": "Thailand", "places": ["Bangkok", "Pattaya", "Phuket", "Krabi", "Koh Samui"] }
```

[`parse-master.ts`](../scripts/etl/parse-master.ts) turns this into a `Place` with id `koh-samui`. For India, `countries[]` entries are *states* with a `subregion`; a new Indian city goes under its state.

Adding the place to a **package** (`packages[].places`) is separate and optional. It only affects the reference package a quote is matched against and the published "from" price floor. A place in no package is still selectable and quotable.

Two things can go wrong here:

- **Wrong country.** A multi-country package repeats its place list on every member country, so a place can be filed under the wrong one (the Kailash route did). That mis-prices visas and cross-border transport. Fix it in `content/place-countries.json`: `"Koh Samui": "Thailand"`. A plain single-country addition does not need this. The build prints `N place(s) with an ambiguous country` if it is unsure.
- **Spelling drift between sources.** The pricing sheet, the `.md` filename and transport endpoints are all matched to the master name. Exact and normalised matches work, and a conservative fuzzy matcher handles close ones and refuses ambiguous ones. If a source says "Ko Samui", add `"Ko Samui": "Koh Samui"` to `content/place-aliases.json`. Aliases beat the fuzzy matcher. The review workbook's `Unmatched Names` sheet lists anything that matched nothing.

### 2. Map marker (also the coordinate)

Add a pin to `content/destinations/south-east-asia.json` under `map.markers`:

```json
{ "name": "Koh Samui", "lat": 9.512, "lng": 100.013, "type": "city", "group": 2, "country": "Thailand" }
```

- `type` must be `"city"` or `"poi"`. Anything else fails schema validation, and `sync-content` throws for the whole file. I hit this with `"island"`.
- `group` is a group id in the same file and drives the click-through offer. It is optional.
- The marker name must match the master spelling, or it stays on the map but cannot be selected in the planner.

[`place-coords.ts`](../scripts/etl/place-coords.ts) resolves one coordinate per place, best source first:

1. The **marker**, which points at the town itself.
2. The primary **airport**, but only if that airport serves this place alone. Shared airports are skipped because they put several towns on one point.
3. The **geocoder** (Nominatim, cached on disk). It runs only with `npm run build-atlas -- --geocode`.

A place that resolves from none of these is reported rather than guessed. A wrong coordinate silently mis-prices every leg touching it.

### 3. Destination markdown

There is no blank template file. The 36-section format is the template, so copy a well-formed neighbour (for Samui, `South East Asia/Countries/thailand/Phuket.md`) to `input_files/Destination Files markdown/South East Asia/Countries/thailand/Koh Samui.md` and rewrite it. A file is matched to a place by **filename**, not folder, but keep the region/country convention. If two files map to one place, the first found wins.

[`parse-destinations.ts`](../scripts/etl/parse-destinations.ts) reads these sections for the engine. The rest is carried as lazily-loaded planner guidance.

| § | What the parser takes | Notes |
| --- | --- | --- |
| header | `destination_id`, `currency`, `timezone`, `destination_type` | Unnumbered blocks before § 1. |
| 2, 3, 4, 5 | Suitability table, best-for / not-ideal-for tags, trip purposes | Scores 0-100. |
| 6 | Min / ideal / max nights | Drives night allocation. |
| 8 | Monthly table: weather, crowd, price, overall | Drives seasonality and advisories. |
| 9 | `Overall cost level` | Scales estimated rates. |
| 11 | Airport codes | Only `IATA: XXX`, or a 3-letter code on a line mentioning airport, terminal or an arrow. Check by hand. |
| 12, 33 | Airport transfer logic; `IF / AND / THEN` decision rules | Rules are evaluated against the request. |
| 14 | Important areas with price level | Mapped to the Central or Outskirts hotel zone. |
| 15 | Activity codes `SAMUI_A_<AREA>` | Join key to workbook activity rates. |
| 16 | First-time visitor priority: the **attraction list** | Bullets only. |
| 17 | Activities by purpose (`## Family`, `## Honeymoon`, ...) | Bullets. |
| 27 | **Geographical clusters**, the day-planning unit | `recommended_duration` becomes `durationHours`; `walking_intensity` is `LOW`, `MEDIUM`, `HIGH` or an arrow combination. |

Cluster format (`##`, `###` or `####` all work):

```
## CLUSTER 3 — NAMERI NATIONAL PARK

attractions:

* Nameri National Park
* Forest walks

recommended_duration: Half day → Full day
walking_intensity: LOW → MEDIUM
```

- The title must be `CLUSTER <integer> — <Name>`. `CLUSTER 5A` is not stripped and would leak into the name.
- A cluster with no `attractions:` list (or `highlights`, `sites`, `includes`) is silently dropped.
- Durations: `1–2 hours` gives 1.5, `Half day` gives 4, `Full day` gives 8, and an unparseable value gives 4.
- If a file yields **no** clusters, the build invents one cluster per priced activity. A file with only one or two clusters loses that fallback, so write a full set or none.

A new attraction touches three places: § 16 (attraction row), § 27 (cluster) and optionally § 17. An entry in § 16 alone is a name with nothing to schedule.

**Bold-field gotcha.** `**key:** value` is normalised before parsing, but `****key:****` and `*****key:*****` (used in the Arunachal Pradesh files) are not. In those files `attractions:`, `recommended_duration` and the § 16 priority bands are unread: no clusters parse and every attraction defaults to priority 60. Use plain `key:` or exactly two asterisks in a new file.

### 4. Transport

Without a route, Samui can still be sequenced from coordinates, but it has no authored fare, terminals or mode choice. Two options:

- **Edit the regional file** `input_files/transport_json_regions/south_east_asia_transport.json`. Add a route under `transport.within_country.routes` (or `between_countries.routes`) and bump `route_count`:

```json
{ "country": "Thailand", "origin": "Bangkok", "destination": "Koh Samui",
  "transport_options": { "flight": { "enabled": true,
    "price_estimate": { "low": 3500, "high": 9000, "currency": "INR", "as_of": "2026-09" },
    "duration_minutes": 65,
    "terminals": { "from": "Suvarnabhumi Airport (BKK)", "to": "Samui Airport (USM)" } } } }
```

  Modes in the existing files are `flight`, `train`, `bus` and `cruise`. A disabled mode needs `"enabled": false` and an `unavailable_reason`. `duration_minutes: null` is allowed; the build derives a time from distance and reports how many legs stay untimed. The figures above are placeholders from my trial, so confirm real fares and times first.
- **Use the transport patch overlay** (`content/transport-patch.json`). It carries the same facts as a route (origin, destination, mode, minutes, fare range, terminals) so you can add or correct a leg without touching the large authored files. It is new and being changed by another engineer, so read its `_about` field and current entries for the exact shape instead of copying from this page.

### 5. Pricing: rows or estimates

- **No workbook sheet** (the default for a new place): hotel (4 star tiers × 2 zones), transfer and meal rates are inferred from the country and the § 9 cost level. Each is tagged `source: "estimated"` and listed in the **Our Estimates** sheet of `data/atlas/Atlas_Rate_Review.xlsx`. The place is quotable and the line items show they are estimated.
- **Activity entry tickets are not estimated.** The review workbook says no free API publishes them. Do not invent rates. Add rows only from a supplier price.
- **To contract rates**, add a sheet to `Pricing_Rules.xlsx` named like the place (aliases apply). Copy an existing sheet: header block, then Hotel / Transport / Meals / Activities rows. Columns are found by header text, so layout variants are tolerated. Activity IDs are `<DEST>_A_<AREA>` and must match the § 15 codes in the markdown.

## What the commands tell you

Run after every edit. Order matters: **build, then gaps**, because `gaps` reads the workbook the build writes.

| Command | Reports |
| --- | --- |
| `npm run build-atlas` | One line per stage: master counts, `content N destination files matched`, `coords X/Y places located (marker / airport / geocoded)`, `transport N routes`, `estimated H hotel, T transfer, M meal rates for unpriced places`, then `N/N places quotable, M with content`. A new place raises places, quotable and content by 1 each. |
| `npm run gaps` | Terminal view of `Atlas_Rate_Review.xlsx`: estimated rates by basis, flight fares derived vs fallback, **Missing Data**, **Missing Files** (places with no `.md` or rate sheet). Samui leaves the missing-`.md` list once its file exists, and stays in "no rate sheet" until you add one. |
| `npm run transport-gaps` | Legs with no priced mode, journey times still missing, places that never appear on a measured leg. Confirms the new place has a coordinate and a route. |
| `npm run sync-content` | Report-only drift between the master and `content/destinations/*.json`: package lists, marker renames, markers naming no place. `-- --write` applies it, keeping hand-authored palette, media, taglines and marker coordinates. Needed when you change **packages**; for a place-only addition it is a validation check on your marker. It already reports drift in `europe` and `india` today, unrelated to a new place. |

`public/atlas/` is gitignored build output. `data/atlas/Atlas_Rate_Review.xlsx` and `data/atlas/sql/seed.sql` are tracked and show as modified after any build.

## Checklist

1. [ ] One canonical spelling, used in the master, marker, filename and transport.
2. [ ] Master: place under the right country or state (and a package, if it should sell as part of one).
3. [ ] If the country is wrong or the name drifts: `place-countries.json` / `place-aliases.json`.
4. [ ] Marker with `type: "city"` or `"poi"` and a verified lat/lng.
5. [ ] `.md` copied from a neighbour. Sections 6, 8, 9, 11, 14, 15, 16, 17, 27 reviewed; plain `key:` fields; clusters numbered with integers.
6. [ ] § 11 names the correct airport as `IATA: XXX`. (Phuket.md currently lists BKK. The build overrides airports more than 300 km away, but do not rely on that.)
7. [ ] At least one route in or out, via the regional file or the patch overlay.
8. [ ] `npm run build-atlas`: places, content and quotable each +1, no new "unresolved" or "ambiguous" lines.
9. [ ] `npm run gaps` and `npm run transport-gaps`: coordinate present, a route present, rates estimated only.
10. [ ] Inspect `public/atlas/destinations/<slug>.json` (`clusters`, `attractions`, `lat`/`lon`) and `core.json` `placeAirports`.
11. [ ] `npm test`, then run a quote that includes the place.
12. [ ] Later: contracted rate sheet to replace the estimates.

## Recommendation: markdown and JSON, or an admin-editable store

*This is a recommendation, not something the codebase has decided.*

**Keep markdown plus JSON for now**, and make the procedure safer instead.

- The app is a static export. Quoting runs in the browser over compiled bundles, and D1 deliberately holds only enquiries and saved quotes. An admin store changes nothing for quoting unless you also add a publish step, because the engine reads files, not rows.
- The source of truth is reviewable: a git diff shows which attraction or rate changed and who changed it. The ETL's matching, estimation and review workbook all assume files.
- Adding a destination is occasional and deliberate, not daily.

**What an admin store would buy.** Non-engineers could add a place or fix an attraction without a pull request. Validation on entry would turn the silent failures above (bad marker `type`, five-asterisk fields, `CLUSTER 5A`) into form errors.

**What it would cost.** A schema for 36 sections of prose (guidance is about 48 KB a place), an admin UI with auth, a publish job that regenerates `public/atlas` and redeploys, a one-off import of 216 files, and the loss of free git history unless you build an audit log. If the store were read at runtime rather than at build time, you would also lose instant client-side repricing and the free-tier cost profile.

**Cheaper steps, in order of value:**

1. Make the parser normalise the 4 to 5 asterisk field form, so the Arunachal clusters actually load. This changes output for those files, so compare `public/atlas` before and after.
2. Add a scaffolder (`npm run new-destination -- "Koh Samui" --country Thailand --lat .. --lng ..`) that edits the master, adds the marker and writes a skeleton `.md` with valid sections 6, 8, 14-17 and 27.
3. Add a CI check that fails when a markdown file yields zero clusters or attractions, or a marker has an invalid `type`.
4. If non-engineers must edit, put a form in front that opens a pull request against the same files, so git stays the source of truth. Move to a database only if edit frequency or editor count makes that unworkable.

## Did I run it?

Yes, on a throwaway copy of the repo, not the working tree. I added Koh Samui to the master, a marker, a `Koh Samui.md` derived from Phuket's (with `IATA: USM`) and one Bangkok to Koh Samui flight route.

- `npm run build-atlas` went from 653/653 to 654/654 places quotable, and from 428 to 429 with content.
- `koh-samui.json` had 9 clusters, 15 attractions and a marker coordinate. `placeAirports` gave USM, and all 8 hotel rates were `estimated`.
- Before the route edit the build reported 1463 routes and none touched Samui. After it, 1464, with the route and its terminals present.
- `sync-content` validated the marker once `type` was `city`.

Not run: a real rate sheet in the workbook, the patch overlay (still being written), and a quote through the UI. The copy was discarded.

## Adding a tour or attraction to an existing destination

An attraction is one block of the destination's markdown. No master, marker or transport edit is needed unless the attraction sits in a different town. This is the procedure used for Nameri, Tipi, Nag Temple, Dirang Dzong and Monpa Village.

1. Open `input_files/Destination Files markdown/<region>/<country>/<Place>.md`.
2. **§ 14**: add `## ATTRACTION NAME` with `best_for`, `price_level`, `transport_convenience`, `advantages`, `disadvantages` and one descriptive paragraph. Put the local name or alias in that paragraph (Tawang Monastery carries "Galden Namgyal Lhatse").
3. **§ 15**: add the code `<PLACE>_A_<ATTRACTION NAME>`. This is the join key for any contracted activity rate.
4. **§ 16**: add a bullet so it appears in the attraction list.
5. **§ 27**: put it in the right `## CLUSTER n` with `recommended_duration`. Clusters are what the day planner schedules; an attraction outside a cluster is listed but never planned.
6. Use plain `key:` fields and integer cluster numbers. The parser also accepts `***key:***` and `*****key:*****`.
7. `npm run build-atlas`, then confirm the id `<place>:poi:<slug>` appears in `public/atlas/destinations/<place>.json` under `attractions` and in a cluster.
8. `npm test`.

An attraction reached from a neighbouring town (Nameri is reached from Bhalukpong) goes in the town that is the overnight base, not the one nearest on the map. Entry tickets stay unpriced until a supplier rate is added to the workbook sheet; do not estimate them.

Not built: a `npm run new-attraction -- --place Dirang --name "Nag Temple"` helper that inserts the four blocks above. The risk is the cluster step, which needs a judgement about which day the attraction belongs with, so the helper should prompt for it rather than guess.
