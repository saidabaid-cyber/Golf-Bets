# Profile geography data

The local profile picker stores ISO 3166-1 alpha-2 country codes and ISO 3166-2
subdivision codes, alongside Spanish display names. It does not use location
permission, geocoding, or a remote country API.

- Country codes: [UN Statistics Division M49 overview](https://unstats.un.org/unsd/methodology/m49/overview/)
  and [ISO 3166 overview](https://www.iso.org/iso-3166-country-codes.html).
  The UN table omits Taiwan; `TW` is included from ISO/CLDR. The 249 entries in
  `profile-geography-data.ts` are pinned to avoid host-ICU display-name drift.
- Spanish labels: [Unicode CLDR](https://cldr.unicode.org/) as exposed through
  `Intl.DisplayNames("es-MX")` when the file was generated. A maintainer should
  compare updates against CLDR's Spanish territory names before regenerating.
- MX, US and CA subdivisions: [Unicode CLDR supplemental subdivision codes](https://github.com/unicode-org/cldr/blob/main/common/supplemental/subdivisions.xml),
  with maintained Spanish labels in `profile-geography-subdivisions.ts`.
  Other countries intentionally use normalized manual text until a trustworthy
  complete subdivision set is added. Do not infer subdivisions from free text.

Unicode data attribution: Copyright © 1991-2026 Unicode, Inc. The data is used
under the [Unicode License v3](https://www.unicode.org/license.txt)
(`SPDX-License-Identifier: Unicode-3.0`). Keep the copyright and license
notice with any redistributed copy or derived dataset.
The complete notice is included in `PROFILE_GEOGRAPHY_LICENSE.txt`.

Maintenance: update codes and labels together, document the source revision,
then run `tests/profile-geography.test.ts`. A country change must continue to
clear both subdivision code and text; existing unknown legacy text must be
preserved until the user replaces it with an ISO selection.
