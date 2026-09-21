# Default tag taxonomy (v1)

Shipped starter tree for new installs. Users can rename, add, move, and delete via tag management. Colors are suggestions; inherit from parent when unset.

Mapped from common sample-pack language and the Claude Design sample data. Tunable after you dogfood.

| Path | Suggested color | Notes |
|------|-----------------|-------|
| `Drums` | `#8B7CF6` | |
| `Drums/Kick` | inherit | |
| `Drums/Kick/808` | inherit | |
| `Drums/Snare` | inherit | |
| `Drums/Clap` | inherit | |
| `Drums/Hats` | inherit | |
| `Drums/Hats/Closed` | inherit | |
| `Drums/Hats/Open` | inherit | |
| `Drums/Perc` | inherit | |
| `Drums/Breaks` | inherit | |
| `Drums/Toms` | inherit | |
| `Drums/Cymbals` | inherit | |
| `Bass` | `#4ADE80` | |
| `Bass/Synth` | inherit | |
| `Bass/Acoustic` | inherit | |
| `Bass/808` | inherit | |
| `Synths` | `#38BDF8` | |
| `Synths/Lead` | inherit | |
| `Synths/Pad` | inherit | |
| `Synths/Keys` | inherit | |
| `Synths/Pluck` | inherit | |
| `Synths/Arp` | inherit | |
| `Vocals` | `#F472B6` | |
| `Vocals/Phrase` | inherit | |
| `Vocals/One-shot` | inherit | |
| `Vocals/Choir` | inherit | |
| `FX` | `#FBBF24` | |
| `FX/Impact` | inherit | |
| `FX/Riser` | inherit | |
| `FX/Sweep` | inherit | |
| `FX/Noise` | inherit | |
| `FX/Glitch` | inherit | |
| `Ambience` | `#94A3B8` | |
| `Ambience/Drone` | inherit | |
| `Ambience/Texture` | inherit | |
| `Field` | `#A78BFA` | Field recordings |
| `Field/City` | inherit | |
| `Field/Nature` | inherit | |
| `Guitar` | `#FB923C` | |
| `Guitar/Electric` | inherit | |
| `Guitar/Acoustic` | inherit | |
| `Strings` | `#C4B5FD` | |
| `Brass` | `#FCD34D` | |
| `Woodwinds` | `#6EE7B7` | |
| `Piano` | `#E2E8F0` | |
| `Genre` | `#64748B` | Optional flavor tags |
| `Genre/House` | inherit | |
| `Genre/Techno` | inherit | |
| `Genre/Hip-Hop` | inherit | |
| `Genre/Trap` | inherit | |
| `Genre/DnB` | inherit | |
| `Genre/Ambient` | inherit | |
| `Genre/Funk` | inherit | |

Filename/path auto-tag (v1 first pass) should match case-insensitive tokens against leaf and path segments (e.g. `kick`, `808`, `snare`, `hat`, `perc`, `bass`, `vocal`, `fx`, `loop`, `oneshot` / `one-shot`) and map into this tree when confident. Unmatched → no auto tag (user can tag later).
