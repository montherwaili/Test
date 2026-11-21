# Buildings and palms

From Kenney (<https://kenney.nl>), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the
`License-*.txt` files). No attribution is required; it is given here with
thanks.

| Files | Kit |
| --- | --- |
| `building-a.json` … `building-h.json`, `commercial-colormap.png` | [City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial) |
| `palmTall.json`, `palm.json`, `palmBend.json` | [Nature Kit](https://kenney.nl/assets/nature-kit) |

Converted to glTF JSON with the buffer inside (some hosts will not serve
`.glb`). The game scales each building to its plot (at most 11 m tall) and
turns it to face the street, and colours the palms as date palms
(`src/render/sceneryModels.ts`).
