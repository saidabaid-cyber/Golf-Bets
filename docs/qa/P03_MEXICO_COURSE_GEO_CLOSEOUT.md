# P03 — Mexico course geography closeout

> **DOCUMENTO HISTÓRICO — NO USAR COMO ESTADO ACTUAL NI RUNBOOK.** Este cierre conserva evidencia de la rama original; sus SHA, métricas y afirmaciones de QA no sustituyen el estado canónico. La fuente operativa es `integration/backyard-current`; consulte el [manifiesto de consolidación](../CONSOLIDATION_MANIFEST_2026-09-24.md), el [estado canónico del producto](../CANONICAL_PRODUCT_STATUS_2026-09-24.md) y el [ledger canónico de migraciones](../CANONICAL_MIGRATION_LEDGER_2026-09-24.md). No ejecute deploys, cambios de entorno ni migraciones a partir de este archivo.

Date: 2026-09-24

Branch: `phase2/admin-control-center-2026-09-22`

Base SHA: `5cc8419f5c93627a6ae99b02b52e9b56e472d4a3`

Final SHA: the immutable commit containing this report; the exact value is recorded in the owner handoff and verified against the fixed Vercel alias.

QA project: `bymeopxkxapfizeeqeyb` (`phase2-full-platform-qa`)

Production project excluded: `zhqmlpljloumldaczcfp`

## Outcome

P03 is **PASS** for code, data validation, and the controlled QA update. Coverage increased from 91 to 150 evidenced club locations without changing club/course/tee/hole identities or counts. Three catalog identities remain intentionally unresolved; national coverage is not claimed as complete.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Operational clubs | 153 | 153 | 0 |
| Geo verified | 91 | 150 | +59 |
| Pending | 62 | 3 | -59 |
| Operational courses | 176 | 176 | 0 |
| Operational tees | 769 | 769 | 0 |
| Holes | 3,096 | 3,096 | 0 |
| Tee-hole yardages | 13,644 | 13,644 | 0 |

The before/after database hashes stayed unchanged for club identity, courses, tees, and holes:

- club identity: `51f6e0d9705c270dca3efac3cfbe83b8`
- courses: `169616e38f1b499095d73cfc2dcd13b9`
- tees: `7d35c5b2dea1ebe535232149c79fcb3d`
- holes: `0bdb1302e07afbea98558331e241f553`

## Controlled QA apply

The write was limited to existing `golf_clubs.latitude`, `golf_clubs.longitude`, and `catalog_metadata.locationEvidence` values for the 59 exact IDs listed below. No DDL, migration, insert, delete, Auth, Storage, tee, rating, scorecard, ownership, or Production operation was executed.

- Pre-apply dry-run: 59 expected / 59 joined / 59 identity matches / 59 clean null locations / 0 conflicts.
- First transactional apply: 59 rows changed.
- Second identical apply: 0 rows changed.
- Exact post-apply readback: 59/59.
- Long-running client transactions before apply: 0.
- Private rollback artifact: `.qa-artifacts/p03-course-geo-before-apply.private.json`
- Rollback artifact SHA-256: `86B7915EF99095F36BDEFCC0DCC1FF7C77F5B8EF16D46FCB9619C1294FCB2EB0`

## Coverage by catalog state

This is the live QA readback after the update. The source catalog contains seven records whose state is absent or represented as `-`; this task did not infer or rewrite those identity fields.

| State | Clubs | Geo verified | Pending |
|---|---:|---:|---:|
| `-` | 1 | 1 | 0 |
| Aguascalientes | 2 | 2 | 0 |
| Baja California | 6 | 6 | 0 |
| Baja California Sur | 16 | 16 | 0 |
| Campeche | 2 | 2 | 0 |
| Chiapas | 1 | 1 | 0 |
| Chihuahua | 4 | 4 | 0 |
| Ciudad de México | 4 | 4 | 0 |
| Coahuila | 6 | 6 | 0 |
| Colima | 1 | 1 | 0 |
| Durango | 1 | 1 | 0 |
| Estado de México | 13 | 13 | 0 |
| Guanajuato | 8 | 8 | 0 |
| Guerrero | 5 | 5 | 0 |
| Hidalgo | 2 | 2 | 0 |
| Jalisco | 8 | 8 | 0 |
| Michoacán | 5 | 5 | 0 |
| Morelos | 5 | 5 | 0 |
| Nayarit | 3 | 3 | 0 |
| Nuevo León | 3 | 3 | 0 |
| Oaxaca | 2 | 2 | 0 |
| Puebla | 7 | 7 | 0 |
| Querétaro | 5 | 5 | 0 |
| Quintana Roo | 10 | 10 | 0 |
| San Luis Potosí | 2 | 2 | 0 |
| State absent | 7 | 5 | 2 |
| Sinaloa | 5 | 5 | 0 |
| Sonora | 3 | 2 | 1 |
| Tabasco | 1 | 1 | 0 |
| Tamaulipas | 6 | 6 | 0 |
| Veracruz | 6 | 6 | 0 |
| Yucatán | 3 | 3 | 0 |

## New location evidence

Evidence policy: exact club/course property points only—never municipal centroids, postcodes, nearby hotels, company offices, or inferred coordinates. Primary sources were preferred; secondary/open map records are explicitly labelled. OSM-derived evidence retains OpenStreetMap/ODbL attribution in the versioned dataset.

| Club | City | State | Lat/Lng | Source | Verified | Status |
|---|---|---|---|---|---|---|
| ALTOZANO EL NUEVO COLIMA | Cuauhtémoc | Colima | `19.317636, -103.671423` | [Altozano Club Colima](https://altozano.com.mx/club-colima/) | 2026-09-24 | PRIMARY |
| AZUL TALAVERA COUNTRY CLUB | Torreón | Coahuila | `25.516562, -103.369064` | [Azul Talavera](https://www.azultalaveracountryclub.com/acerca-de-nosotros-historia-torreon/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Baja Country Club | Ensenada | Baja California | `31.766920, -116.519874` | [Baja Country Club](https://bajacountryclub.com/contact-us/) | 2026-09-24 | PRIMARY_SUPPORTED |
| BOSQUES CLUB DE GOLF | Ciudad de México | Ciudad de México | `19.377393, -99.277458` | [Club de Golf Bosques](https://www.clubdegolfbosques.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Cabo del Sol | Cabo San Lucas | Baja California Sur | `22.921810, -109.843934` | [Cabo del Sol](https://www.cabodelsol.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CAMPECHE COUNTRY CLUB | San Francisco de Campeche | Campeche | `19.787707, -90.627973` | [Campeche Country Club](http://campechecountryclub.com.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CCC COUNTRY CLUB PLAYA PALMAS | Ciudad del Carmen | Campeche | `18.670066, -91.778079` | [exact place record](https://www.google.com/maps/search/?api=1&query=CCC%20Country%20Club%20Playa%20Palmas%20Ciudad%20del%20Carmen) | 2026-09-24 | SECONDARY_EXACT |
| CENTRO ASTURIANO DE MEXICO | Atlatlahucan | Morelos | `18.975096, -98.865454` | [Centro Asturiano](https://www.centroasturianodemexico.com/club-campestre-ecologico/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE DE AGUASCALIENTES | Aguascalientes | Aguascalientes | `21.920441, -102.319512` | [Campestre Aguascalientes](http://www.campestreags.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE DE DURANGO | Durango | Durango | `23.972209, -104.660727` | [Campestre Durango](https://clubcampestrededurango.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE DE MORELIA | Morelia | Michoacán | `19.681656, -101.158502` | [Campestre Morelia](https://www.clubcampestremorelia.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE DE SAN LUIS | San Luis Potosí | San Luis Potosí | `22.159470, -101.010732` | [Campestre San Luis](https://clubcampestresanluis.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE ERANDENI | Tarímbaro | Michoacán | `19.755248, -101.187221` | [Erandeni](https://cluberandeni.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE LOMAS DE COCOYOC | Atlatlahucan | Morelos | `18.914654, -98.941881` | [Lomas de Cocoyoc](http://campestrecocoyoc.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB CAMPESTRE LOURDES | Saltillo | Coahuila | `25.385686, -100.997168` | [exact place record](https://www.google.com/maps/search/?api=1&query=Club%20Campestre%20Lourdes%20Saltillo) | 2026-09-24 | SECONDARY_EXACT |
| CLUB CAMPESTRE RIAMA | Salamanca | Guanajuato | `20.580023, -101.186428` | [exact place record](https://www.google.com/maps/search/?api=1&query=Club%20Campestre%20Riama%20Salamanca) | 2026-09-24 | SECONDARY_EXACT |
| CLUB CAMPESTRE TUXTLA | Tuxtla Gutiérrez | Chiapas | `16.759653, -93.126174` | [FullGolf](https://fullgolf.com/en/golf-course/mexico/chiapas/tuxtla-gutierrez/tuxtla) | 2026-09-24 | SECONDARY_EXACT |
| CLUB DE GOLF ALTOZANO EL NUEVO TABASCO | Villahermosa | Tabasco | `17.952849, -92.805491` | [Altozano Tabasco](https://altozano.com.mx/club-tabasco/) | 2026-09-24 | PRIMARY |
| CLUB DE GOLF BALVANERA | Corregidora | Querétaro | `20.540511, -100.469651` | [Balvanera](https://www.balvanera.com.mx/golf.php) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB DE GOLF CAÑADA DE SANTA FE | Ciudad de México | Ciudad de México | `19.351787, -99.269412` | [exact place record](https://www.google.com/maps/search/?api=1&query=Club%20de%20Golf%20Ca%C3%B1ada%20de%20Santa%20Fe) | 2026-09-24 | SECONDARY_EXACT |
| CLUB DE GOLF LA PRIMAVERA | Culiacán | Sinaloa | `24.721621, -107.391999` | [Ayuntamiento de Culiacán](https://economia.culiacan.gob.mx/directorio-de-empresas-y-servicios/campos-de-golf/club-de-golf-la-primavera/) | 2026-09-24 | GOVERNMENT_SUPPORTED |
| CLUB DE GOLF LA VILLA RICA | Alvarado | Veracruz | `19.077195, -96.100607` | [exact place record](https://www.google.com/maps/search/?api=1&query=Club%20de%20Golf%20La%20Villa%20Rica%20Alvarado) | 2026-09-24 | SECONDARY_EXACT |
| CLUB DE GOLF LAGUNAS DE MIRALTA | Altamira | Tamaulipas | `22.351030, -97.900737` | [exact place record](https://www.google.com/maps/search/?api=1&query=Club%20de%20Golf%20Lagunas%20de%20Miralta%20Altamira) | 2026-09-24 | SECONDARY_EXACT |
| CLUB DE GOLF LOS NARANJOS | León | Guanajuato | `21.165740, -101.637525` | [Los Naranjos](http://clublosnaranjos.com.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB DE GOLF MALINALCO | Malinalco | Estado de México | `18.989964, -99.473415` | [OpenStreetMap way 380171661](https://www.openstreetmap.org/way/380171661) | 2026-09-24 | OPEN_DATA_EXACT |
| CLUB DE GOLF PULGAS PANDAS | Aguascalientes | Aguascalientes | `21.913315, -102.300484` | [Pulgas Pandas](http://www.clubdegolfpulgaspandas.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB DE GOLF SAN GIL | San Juan del Río | Querétaro | `20.449376, -100.070543` | [San Gil](https://sangil.mx/category/san-gil/) | 2026-09-24 | PRIMARY_SUPPORTED |
| CLUB DE GOLF YUCATAN | Mérida | Yucatán | `21.094221, -89.621133` | [Club de Golf Yucatán](http://www.golfyucatan.com.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| COLA DE LAGARTO CAMPO MÍTICO | Atlixco | Puebla | `18.869335, -98.380639` | [Cola de Lagarto](http://www.coladelagarto.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Costa Palmas Golf Club | La Ribera | Baja California Sur | `23.610760, -109.589956` | [Four Seasons Costa Palmas](https://www.fourseasons.com/costapalmas/golf/) | 2026-09-24 | PRIMARY_SUPPORTED |
| COUNTRY CLUB DE CHAPALA | Chapala | Jalisco | `20.335491, -103.121689` | [Chapala Country Club](http://www.ccchapala.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Country Club de Los Mochis | Los Mochis | Sinaloa | `25.790970, -109.009216` | [Country Club Los Mochis](http://countrylosmochis.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| COUNTRY CLUB MANTE | Ciudad Mante | Tamaulipas | `22.714880, -98.967320` | [18Birdies](https://18birdies.com/golf-courses/club/7eea03c0-86ac-11e4-8c28-020000005b00/country-club-mante) | 2026-09-24 | SECONDARY_CORROBORATED |
| DANZANTE BAY GOLF CLUB | Loreto | Baja California Sur | `25.715392, -111.229030` | [TPC Danzante Bay](https://www.tpc.com/danzantebay/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Diamante Cabo San Lucas | Cabo San Lucas | Baja California Sur | `22.896977, -109.982344` | [Diamante](http://www.diamantecabosanlucas.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| EL CORTES GOLF CLUB | La Paz | Baja California Sur | `24.221927, -110.302953` | [Puerta Cortés](https://www.puertacortes.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| El Dorado Golf & Beach Club | San José del Cabo | Baja California Sur | `22.990049, -109.746619` | [El Dorado](https://www.eldoradobeachclub.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Estrella Del Mar Golf Club | Mazatlán | Sinaloa | `23.109351, -106.304307` | [Estrella del Mar](https://estrelladelmar.com/es/golf) | 2026-09-24 | PRIMARY_SUPPORTED |
| GOLF BOSQUE MONARCA | Morelia | Michoacán | `19.640890, -101.165510` | [exact place record](https://www.google.com/maps/search/?api=1&query=Golf%20Bosque%20Monarca%20Morelia) | 2026-09-24 | SECONDARY_EXACT |
| GRAN COYOTE GOLF | Playa del Carmen | Quintana Roo | `20.663465, -87.045708` | [Gran Coyote](http://www.grancoyotegolf.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| GRAN RESERVA GOLF RESORT & COUNTRY CLUB | Ixtapan de la Sal | Estado de México | `18.850645, -99.681842` | [Gran Reserva](http://www.granreserva.com.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| HIGUERA GOLF CLUB | Litibú | Nayarit | `20.797951, -105.482885` | [Higuera](http://www.higueragolfclub.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| LA ESMERALDA COUNTRY CLUB | Tecámac | Estado de México | `19.725740, -98.932528` | [La Esmeralda](http://www.golflaesmeralda.com.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Loreto Bay Golf Resort and Spa | Loreto | Baja California Sur | `25.920639, -111.348108` | [Loreto Bay](https://www.loretobayresort.com/es/) | 2026-09-24 | PRIMARY_SUPPORTED |
| NAUKA GOLF CLUB | Compostela | Nayarit | `21.094022, -105.221850` | [Nauka](http://www.naukanayarit.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Oleada Golf Links Los Cabos | Cabo San Lucas | Baja California Sur | `22.903537, -109.994549` | [Oleada](https://oleadaloscabos.com/oleada-golf-links/) | 2026-09-24 | PRIMARY_SUPPORTED |
| PALMA REAL GOLF & BEACH CLUB | Ixtapa Zihuatanejo | Guerrero | `17.654859, -101.594449` | [Palma Real](https://www.golfpalmareal.mx/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Palmilla Golf Club | San José del Cabo | Baja California Sur | `23.017968, -109.732029` | [One&Only Palmilla](https://www.oneandonlyresorts.com/palmilla/experiences/golf) | 2026-09-24 | PRIMARY_SUPPORTED |
| PARAISO DEL MAR GOLF CLUB | La Paz | Baja California Sur | `24.166400, -110.337132` | [Paraíso del Mar](https://paraisodelmar.com/es/club-golf/) | 2026-09-24 | PRIMARY_SUPPORTED |
| PRINCESS MUNDO IMPERIAL GOLF CLUB | Acapulco | Guerrero | `16.791127, -99.811971` | [Mundo Imperial](https://www.mundoimperial.com/princess/disfrutar-relajarse/golf/princess-golf-course) | 2026-09-24 | PRIMARY_SUPPORTED |
| PROVINCIA GOLF CLUB | Mérida | Yucatán | `21.142527, -89.661221` | [exact place record](https://www.google.com/maps/search/?api=1&query=Provincia%20Golf%20Club%20M%C3%A9rida) | 2026-09-24 | SECONDARY_EXACT |
| PUNTA TIBURON COUNTRY CLUB | Alvarado | Veracruz | `19.064925, -96.095565` | [Punta Tiburón](https://www.puntatiburoncountryclub.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| RIO GRANDE COUNTRY CLUB | Nava | Coahuila | `28.580227, -100.522735` | [Rio Grande](https://riograndecountryclub.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| TAJIN CLUB DE GOLF | Coatzintla | Veracruz | `20.488795, -97.491599` | [exact place record](https://www.google.com/maps/search/?api=1&query=Taj%C3%ADn%20Club%20de%20Golf%20Coatzintla) | 2026-09-24 | SECONDARY_EXACT |
| THE SPRINGS GOLF CLUB | Ascensión | Chihuahua | `30.051602, -107.593699` | [exact place record](https://www.google.com/maps/search/?api=1&query=The%20Springs%20Golf%20Club%20Chihuahua) | 2026-09-24 | SECONDARY_EXACT |
| Twin Dolphin Club | Cabo San Lucas | Baja California Sur | `22.935238, -109.827003` | [Twin Dolphin](https://www.twindolphin.com/) | 2026-09-24 | PRIMARY_SUPPORTED |
| Vidanta Golf Los Cabos | San José del Cabo | Baja California Sur | `23.048083, -109.704339` | [Vidanta Los Cabos](https://www.vidanta.com/web/los-cabos/golf) | 2026-09-24 | PRIMARY_SUPPORTED |
| Vidanta Golf Puerto Penasco | Puerto Peñasco | Sonora | `31.245586, -113.247399` | [Vidanta Puerto Peñasco](https://vidanta.com/en/web/puerto-penasco/golf) | 2026-09-24 | PRIMARY_SUPPORTED |
| YUCATAN COUNTRY CLUB | Mérida | Yucatán | `21.120521, -89.600111` | [Inmobilia Yucatán Country](https://www.inmobilia.mx/yucatancountry) | 2026-09-24 | PRIMARY_SUPPORTED |

Confidence summary: 2 PRIMARY, 43 PRIMARY_SUPPORTED, 1 GOVERNMENT_SUPPORTED, 1 OPEN_DATA_EXACT, 11 SECONDARY_EXACT, and 1 SECONDARY_CORROBORATED. Secondary evidence remains explicitly distinguished from primary evidence.

## Remaining pending identities

| Club | Status | Reason | Evidence consulted |
|---|---|---|---|
| CAMPO DE GOLF NAVAL | PENDING_LOCATION | The Naval Academy confirms a nine-hole course, but an exact course point was not found; the school centroid was rejected. | [Heroica Escuela Naval](https://henm.uninav.edu.mx/quienesSomos.html) |
| CLUB CAMPESTRE REAL DEL CATORCE | PENDING_OPERATION_CONFIRMATION | Historical identity exists, but current sources primarily describe the residential development; current golf operation was not confirmed. | [Hermosillo public listing](https://www.hermosillo.gob.mx/pages/fraccionamientos-campestres.aspx) |
| Punta Brava Golf & Surf Club | PROJECT_NOT_PLAYABLE | Current evidence describes a development/construction project, not a playable operational club. | [Leading Courses status](https://www.leadingcourses.com/clubs/north-america%2Bmexico/punta-brava-golf-surf-club) |

## Nearby behavior

Behavior tests derive results with Haversine, a 50 km radius, stable `clubId` deduplication, ascending distance, and a maximum of three clubs. No region-specific result is hardcoded.

| Simulated origin | First three distinct clubs from versioned catalog |
|---|---|
| Puebla / Cholula | Campestre de Puebla (4.3 km), Las Fuentes (5.9 km), La Vista (6.3 km) |
| CDMX | Campestre CDMX (9.1 km), El Copal (11.3 km), Chapultepec (11.7 km) |
| Querétaro | Campestre Querétaro (3.3 km), Balvanera (9.9 km), Zibatá (12.0 km) |
| Guadalajara | Guadalajara Country Club (4.3 km), Las Cañadas (12.5 km), Valle Imperial (15.9 km) |
| Monterrey | Campestre Monterrey (5.5 km), Valle Alto (14.2 km), Las Cruces (23.9 km) |
| Cancún | Puerto Cancún (4.2 km), Pok Ta Pok (9.8 km), Playa Mujeres (11.2 km) |
| Los Cabos | Cabo San Lucas CC (1.3 km), Cabo del Sol (6.1 km), Quivira (6.6 km) |
| Puerto Vallarta | Marina Vallarta (3.7 km), Paradise Village (7.7 km), Higuera (31.2 km) |

Puebla P02 remains intact: seven club identities are geo verified, La Vista/Campestre/La Huerta remain distinct, and the geography update did not modify cards, tees, or nine-hole identities.

## Verification

- P03 focused behavior tests: 17 passed, 0 failed/skipped/cancelled.
- Full suite: 3,377 passed, 0 failed, 0 skipped, 0 cancelled.
- TypeScript (`tsc --noEmit`): PASS.
- ESLint (`eslint .`): PASS.
- Production build (`next build`): PASS, 34/34 static pages generated.
- Repository whitespace validation (`git diff --check`): PASS.
- Commands executed: `tsc -p tsconfig.test.json`, `node --test .test-dist/tests/*.test.js`, `tsc --noEmit`, `eslint .`, `next build`, and `git diff --check`.
- Fixed-alias runtime smoke and Vercel SHA binding are recorded in the final owner handoff after deployment of the immutable commit.
- Physical iPhone geolocation prompts remain `PENDING_DEVICE_QA`; deterministic permission/location tests and live catalog readback do not substitute for hardware.

## Scope confirmation

- Preview/QA only.
- No migration or DDL.
- No Production, main, beta, DNS, Auth, Storage, users, rounds, tees, ratings, scorecards, equipment, Social, bets, or Profile changes.
- National tee/card work and hole GPS/shot tracking were not started.
