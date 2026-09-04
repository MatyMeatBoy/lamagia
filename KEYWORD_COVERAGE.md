# Keyword coverage

Generated from the local Comprehensive Rules snapshot and the normalized catalog. The report distinguishes keyword abilities from keyword actions and ability words; a high catalog count is a prioritization signal, not proof that all variants share one implementation.

**Summary:** 27 implemented · 2 partial · 165 backlog

`catalog occurrences` counts Scryfall keyword metadata and is used to prioritize reusable primitives. Every implementation still requires a scenario test and a Comprehensive Rules citation.

Source: [Keyword ability](https://mtg.fandom.com/wiki/Keyword_ability) and the checked-in [Comprehensive Rules](docs/COMPREHENSIVE_RULES.md).

| CR | Keyword | Status | Catalog occurrences | Engine contract |
|---|---|---|---:|---|
| 702.2 | Deathtouch | implemented | 1158 | combat damage / lethal assignment |
| 702.3 | Defender | implemented | 919 | attack legality |
| 702.4 | Double Strike | implemented | 387 | first- and double-strike combat steps |
| 702.5 | Enchant | backlog | 3575 | Needs a dedicated rules primitive and scenario tests |
| 702.6 | Equip | implemented | 1809 | activated equipment attachment |
| 702.7 | First Strike | implemented | 1264 | first- and double-strike combat steps |
| 702.8 | Flash | implemented | 1768 | instant-speed casting |
| 702.9 | Flying | implemented | 10829 | evasion and blocking |
| 702.10 | Haste | implemented | 2200 | summoning-sickness exemption |
| 702.11 | Hexproof | implemented | 303 | target legality |
| 702.12 | Indestructible | implemented | 529 | destruction replacement |
| 702.13 | Intimidate | backlog | 59 | Needs a dedicated rules primitive and scenario tests |
| 702.14 | Landwalk | implemented | 402 | combat evasion by land subtype |
| 702.15 | Lifelink | implemented | 1336 | combat damage life gain |
| 702.16 | Protection | partial | 621 | not yet a complete source/quality prevention layer |
| 702.17 | Reach | implemented | 1113 | flying blocking |
| 702.18 | Shroud | implemented | 110 | target legality |
| 702.19 | Trample | implemented | 3060 | combat damage assignment |
| 702.20 | Vigilance | implemented | 2218 | attack does not tap |
| 702.21 | Ward | partial | 595 | not yet a complete payment/counter layer |
| 702.22 | Banding | backlog | 97 | Needs a dedicated rules primitive and scenario tests |
| 702.23 | Rampage | backlog | 35 | Needs a dedicated rules primitive and scenario tests |
| 702.24 | Cumulative Upkeep | backlog | 137 | Needs a dedicated rules primitive and scenario tests |
| 702.25 | Flanking | backlog | 61 | Needs a dedicated rules primitive and scenario tests |
| 702.26 | Phasing | backlog | 17 | Needs a dedicated rules primitive and scenario tests |
| 702.27 | Buyback | backlog | 99 | Needs a dedicated rules primitive and scenario tests |
| 702.28 | Shadow | implemented | 101 | symmetric shadow evasion and blocking |
| 702.29 | Cycling | implemented | 2060 | cycling action and optional search variants |
| 702.30 | Echo | backlog | 147 | Needs a dedicated rules primitive and scenario tests |
| 702.31 | Horsemanship | implemented | 55 | symmetric horsemanship evasion and blocking |
| 702.32 | Fading | backlog | 44 | Needs a dedicated rules primitive and scenario tests |
| 702.33 | Kicker | implemented | 652 | alternative/additional cast cost |
| 702.34 | Flashback | backlog | 793 | Needs a dedicated rules primitive and scenario tests |
| 702.35 | Madness | backlog | 230 | Needs a dedicated rules primitive and scenario tests |
| 702.36 | Fear | backlog | 120 | Needs a dedicated rules primitive and scenario tests |
| 702.37 | Morph | backlog | 344 | Needs a dedicated rules primitive and scenario tests |
| 702.38 | Amplify | backlog | 14 | Needs a dedicated rules primitive and scenario tests |
| 702.39 | Provoke | backlog | 16 | Needs a dedicated rules primitive and scenario tests |
| 702.40 | Storm | backlog | 165 | Needs a dedicated rules primitive and scenario tests |
| 702.41 | Affinity | backlog | 216 | Needs a dedicated rules primitive and scenario tests |
| 702.42 | Entwine | backlog | 68 | Needs a dedicated rules primitive and scenario tests |
| 702.43 | Modular | backlog | 59 | Needs a dedicated rules primitive and scenario tests |
| 702.44 | Sunburst | backlog | 39 | Needs a dedicated rules primitive and scenario tests |
| 702.45 | Bushido | backlog | 51 | Needs a dedicated rules primitive and scenario tests |
| 702.46 | Soulshift | backlog | 34 | Needs a dedicated rules primitive and scenario tests |
| 702.47 | Splice | backlog | 55 | Needs a dedicated rules primitive and scenario tests |
| 702.48 | Offering | backlog | 15 | Needs a dedicated rules primitive and scenario tests |
| 702.49 | Ninjutsu | backlog | 173 | Needs a dedicated rules primitive and scenario tests |
| 702.50 | Epic | backlog | 7 | Needs a dedicated rules primitive and scenario tests |
| 702.51 | Convoke | backlog | 316 | Needs a dedicated rules primitive and scenario tests |
| 702.52 | Dredge | backlog | 80 | Needs a dedicated rules primitive and scenario tests |
| 702.53 | Transmute | backlog | 37 | Needs a dedicated rules primitive and scenario tests |
| 702.54 | Bloodthirst | backlog | 64 | Needs a dedicated rules primitive and scenario tests |
| 702.55 | Haunt | backlog | 17 | Needs a dedicated rules primitive and scenario tests |
| 702.56 | Replicate | backlog | 44 | Needs a dedicated rules primitive and scenario tests |
| 702.57 | Forecast | backlog | 24 | Needs a dedicated rules primitive and scenario tests |
| 702.58 | Graft | backlog | 39 | Needs a dedicated rules primitive and scenario tests |
| 702.59 | Recover | backlog | 9 | Needs a dedicated rules primitive and scenario tests |
| 702.60 | Ripple | backlog | 7 | Needs a dedicated rules primitive and scenario tests |
| 702.61 | Split Second | backlog | 80 | Needs a dedicated rules primitive and scenario tests |
| 702.62 | Suspend | backlog | 239 | Needs a dedicated rules primitive and scenario tests |
| 702.63 | Vanishing | backlog | 66 | Needs a dedicated rules primitive and scenario tests |
| 702.64 | Absorb | backlog | 0 | Needs a dedicated rules primitive and scenario tests |
| 702.65 | Aura Swap | backlog | 1 | Needs a dedicated rules primitive and scenario tests |
| 702.66 | Delve | backlog | 114 | Needs a dedicated rules primitive and scenario tests |
| 702.67 | Fortify | backlog | 4 | Needs a dedicated rules primitive and scenario tests |
| 702.68 | Frenzy | backlog | 1 | Needs a dedicated rules primitive and scenario tests |
| 702.69 | Gravestorm | backlog | 5 | Needs a dedicated rules primitive and scenario tests |
| 702.70 | Poisonous | backlog | 0 | Needs a dedicated rules primitive and scenario tests |
| 702.71 | Transfigure | backlog | 1 | Needs a dedicated rules primitive and scenario tests |
| 702.72 | Champion | backlog | 24 | Needs a dedicated rules primitive and scenario tests |
| 702.73 | Changeling | implemented | 251 | every creature subtype for subtype checks |
| 702.74 | Evoke | implemented | 190 | alternative cast cost and sacrifice trigger |
| 702.75 | Hideaway | backlog | 93 | Needs a dedicated rules primitive and scenario tests |
| 702.76 | Prowl | backlog | 19 | Needs a dedicated rules primitive and scenario tests |
| 702.77 | Reinforce | backlog | 20 | Needs a dedicated rules primitive and scenario tests |
| 702.78 | Conspire | backlog | 17 | Needs a dedicated rules primitive and scenario tests |
| 702.79 | Persist | backlog | 65 | Needs a dedicated rules primitive and scenario tests |
| 702.80 | Wither | backlog | 46 | Needs a dedicated rules primitive and scenario tests |
| 702.81 | Retrace | backlog | 54 | Needs a dedicated rules primitive and scenario tests |
| 702.82 | Devour | backlog | 62 | Needs a dedicated rules primitive and scenario tests |
| 702.83 | Exalted | implemented | 95 | sole-attacker temporary pump trigger |
| 702.84 | Unearth | backlog | 157 | Needs a dedicated rules primitive and scenario tests |
| 702.85 | Cascade | backlog | 169 | Needs a dedicated rules primitive and scenario tests |
| 702.86 | Annihilator | backlog | 80 | Needs a dedicated rules primitive and scenario tests |
| 702.87 | Level Up | implemented | 63 | activated level counters and level layers |
| 702.88 | Rebound | backlog | 107 | Needs a dedicated rules primitive and scenario tests |
| 702.89 | Umbra Armor | backlog | 52 | Needs a dedicated rules primitive and scenario tests |
| 702.90 | Infect | backlog | 95 | Needs a dedicated rules primitive and scenario tests |
| 702.91 | Battle Cry | backlog | 38 | Needs a dedicated rules primitive and scenario tests |
| 702.92 | Living Weapon | backlog | 68 | Needs a dedicated rules primitive and scenario tests |
| 702.93 | Undying | backlog | 62 | Needs a dedicated rules primitive and scenario tests |
| 702.94 | Miracle | backlog | 51 | Needs a dedicated rules primitive and scenario tests |
| 702.95 | Soulbond | backlog | 60 | Needs a dedicated rules primitive and scenario tests |
| 702.96 | Overload | backlog | 129 | Needs a dedicated rules primitive and scenario tests |
| 702.97 | Scavenge | backlog | 31 | Needs a dedicated rules primitive and scenario tests |
| 702.98 | Unleash | backlog | 33 | Needs a dedicated rules primitive and scenario tests |
| 702.99 | Cipher | backlog | 29 | Needs a dedicated rules primitive and scenario tests |
| 702.100 | Evolve | backlog | 64 | Needs a dedicated rules primitive and scenario tests |
| 702.101 | Extort | implemented | 63 | optional spell-cast drain trigger |
| 702.102 | Fuse | backlog | 46 | Needs a dedicated rules primitive and scenario tests |
| 702.103 | Bestow | backlog | 84 | Needs a dedicated rules primitive and scenario tests |
| 702.104 | Tribute | backlog | 15 | Needs a dedicated rules primitive and scenario tests |
| 702.105 | Dethrone | backlog | 32 | Needs a dedicated rules primitive and scenario tests |
| 702.106 | Hidden Agenda | backlog | 16 | Needs a dedicated rules primitive and scenario tests |
| 702.107 | Outlast | backlog | 44 | Needs a dedicated rules primitive and scenario tests |
| 702.108 | Prowess | implemented | 258 | noncreature-spell temporary pump trigger |
| 702.109 | Dash | backlog | 56 | Needs a dedicated rules primitive and scenario tests |
| 702.110 | Exploit | backlog | 62 | Needs a dedicated rules primitive and scenario tests |
| 702.111 | Menace | implemented | 1115 | blocking restriction |
| 702.112 | Renown | backlog | 47 | Needs a dedicated rules primitive and scenario tests |
| 702.113 | Awaken | backlog | 36 | Needs a dedicated rules primitive and scenario tests |
| 702.114 | Devoid | backlog | 225 | Needs a dedicated rules primitive and scenario tests |
| 702.115 | Ingest | backlog | 13 | Needs a dedicated rules primitive and scenario tests |
| 702.116 | Myriad | backlog | 68 | Needs a dedicated rules primitive and scenario tests |
| 702.117 | Surge | backlog | 26 | Needs a dedicated rules primitive and scenario tests |
| 702.118 | Skulk | backlog | 38 | Needs a dedicated rules primitive and scenario tests |
| 702.119 | Emerge | backlog | 48 | Needs a dedicated rules primitive and scenario tests |
| 702.120 | Escalate | backlog | 38 | Needs a dedicated rules primitive and scenario tests |
| 702.121 | Melee | backlog | 28 | Needs a dedicated rules primitive and scenario tests |
| 702.122 | Crew | backlog | 531 | Needs a dedicated rules primitive and scenario tests |
| 702.123 | Fabricate | backlog | 48 | Needs a dedicated rules primitive and scenario tests |
| 702.124 | Partner | backlog | 461 | Needs a dedicated rules primitive and scenario tests |
| 702.125 | Undaunted | backlog | 15 | Needs a dedicated rules primitive and scenario tests |
| 702.126 | Improvise | backlog | 82 | Needs a dedicated rules primitive and scenario tests |
| 702.127 | Aftermath | backlog | 97 | Needs a dedicated rules primitive and scenario tests |
| 702.128 | Embalm | backlog | 45 | Needs a dedicated rules primitive and scenario tests |
| 702.129 | Eternalize | backlog | 43 | Needs a dedicated rules primitive and scenario tests |
| 702.130 | Afflict | backlog | 29 | Needs a dedicated rules primitive and scenario tests |
| 702.131 | Ascend | backlog | 84 | Needs a dedicated rules primitive and scenario tests |
| 702.132 | Assist | backlog | 20 | Needs a dedicated rules primitive and scenario tests |
| 702.133 | Jump-Start | backlog | 30 | Needs a dedicated rules primitive and scenario tests |
| 702.134 | Mentor | backlog | 65 | Needs a dedicated rules primitive and scenario tests |
| 702.135 | Afterlife | backlog | 30 | Needs a dedicated rules primitive and scenario tests |
| 702.136 | Riot | backlog | 25 | Needs a dedicated rules primitive and scenario tests |
| 702.137 | Spectacle | backlog | 35 | Needs a dedicated rules primitive and scenario tests |
| 702.138 | Escape | backlog | 98 | Needs a dedicated rules primitive and scenario tests |
| 702.139 | Companion | backlog | 98 | Needs a dedicated rules primitive and scenario tests |
| 702.140 | Mutate | backlog | 146 | Needs a dedicated rules primitive and scenario tests |
| 702.141 | Encore | backlog | 73 | Needs a dedicated rules primitive and scenario tests |
| 702.142 | Boast | backlog | 45 | Needs a dedicated rules primitive and scenario tests |
| 702.143 | Foretell | backlog | 129 | Needs a dedicated rules primitive and scenario tests |
| 702.144 | Demonstrate | backlog | 22 | Needs a dedicated rules primitive and scenario tests |
| 702.145 | Daybound and Nightbound | backlog | 0 | Needs a dedicated rules primitive and scenario tests |
| 702.146 | Disturb | backlog | 80 | Needs a dedicated rules primitive and scenario tests |
| 702.147 | Decayed | backlog | 8 | Needs a dedicated rules primitive and scenario tests |
| 702.148 | Cleave | backlog | 50 | Needs a dedicated rules primitive and scenario tests |
| 702.149 | Training | backlog | 40 | Needs a dedicated rules primitive and scenario tests |
| 702.150 | Compleated | backlog | 56 | Needs a dedicated rules primitive and scenario tests |
| 702.151 | Reconfigure | backlog | 64 | Needs a dedicated rules primitive and scenario tests |
| 702.152 | Blitz | backlog | 48 | Needs a dedicated rules primitive and scenario tests |
| 702.153 | Casualty | backlog | 38 | Needs a dedicated rules primitive and scenario tests |
| 702.154 | Enlist | backlog | 26 | Needs a dedicated rules primitive and scenario tests |
| 702.155 | Read Ahead | backlog | 21 | Needs a dedicated rules primitive and scenario tests |
| 702.156 | Ravenous | backlog | 24 | Needs a dedicated rules primitive and scenario tests |
| 702.157 | Squad | backlog | 36 | Needs a dedicated rules primitive and scenario tests |
| 702.158 | Space Sculptor | backlog | 0 | Needs a dedicated rules primitive and scenario tests |
| 702.159 | Visit | backlog | 0 | Needs a dedicated rules primitive and scenario tests |
| 702.160 | Prototype | backlog | 49 | Needs a dedicated rules primitive and scenario tests |
| 702.161 | Living Metal | backlog | 25 | Needs a dedicated rules primitive and scenario tests |
| 702.162 | More Than Meets the Eye | backlog | 29 | Needs a dedicated rules primitive and scenario tests |
| 702.163 | For Mirrodin! | backlog | 28 | Needs a dedicated rules primitive and scenario tests |
| 702.164 | Toxic | backlog | 89 | Needs a dedicated rules primitive and scenario tests |
| 702.165 | Backup | backlog | 50 | Needs a dedicated rules primitive and scenario tests |
| 702.166 | Bargain | backlog | 38 | Needs a dedicated rules primitive and scenario tests |
| 702.167 | Craft | backlog | 34 | Needs a dedicated rules primitive and scenario tests |
| 702.168 | Disguise | backlog | 78 | Needs a dedicated rules primitive and scenario tests |
| 702.169 | Solved | backlog | 27 | Needs a dedicated rules primitive and scenario tests |
| 702.170 | Plot | backlog | 86 | Needs a dedicated rules primitive and scenario tests |
| 702.171 | Saddle | backlog | 73 | Needs a dedicated rules primitive and scenario tests |
| 702.172 | Spree | backlog | 56 | Needs a dedicated rules primitive and scenario tests |
| 702.173 | Freerunning | backlog | 21 | Needs a dedicated rules primitive and scenario tests |
| 702.174 | Gift | backlog | 55 | Needs a dedicated rules primitive and scenario tests |
| 702.175 | Offspring | backlog | 50 | Needs a dedicated rules primitive and scenario tests |
| 702.176 | Impending | backlog | 31 | Needs a dedicated rules primitive and scenario tests |
| 702.177 | Exhaust | backlog | 90 | Needs a dedicated rules primitive and scenario tests |
| 702.178 | Max Speed | backlog | 86 | Needs a dedicated rules primitive and scenario tests |
| 702.179 | Start Your Engines! | backlog | 111 | Needs a dedicated rules primitive and scenario tests |
| 702.180 | Harmonize | backlog | 21 | Needs a dedicated rules primitive and scenario tests |
| 702.181 | Mobilize | backlog | 30 | Needs a dedicated rules primitive and scenario tests |
| 702.182 | Job Select | backlog | 28 | Needs a dedicated rules primitive and scenario tests |
| 702.183 | Tiered | backlog | 8 | Needs a dedicated rules primitive and scenario tests |
| 702.184 | Station | backlog | 91 | Needs a dedicated rules primitive and scenario tests |
| 702.185 | Warp | backlog | 82 | Needs a dedicated rules primitive and scenario tests |
| 702.186 | ∞ (Infinity) | backlog | 0 | Needs a dedicated rules primitive and scenario tests |
| 702.187 | Mayhem | backlog | 43 | Needs a dedicated rules primitive and scenario tests |
| 702.188 | Web-slinging | backlog | 30 | Needs a dedicated rules primitive and scenario tests |
| 702.189 | Firebending | backlog | 58 | Needs a dedicated rules primitive and scenario tests |
| 702.190 | Sneak | backlog | 64 | Needs a dedicated rules primitive and scenario tests |
| 702.191 | Increment | backlog | 16 | Needs a dedicated rules primitive and scenario tests |
| 702.192 | Paradigm | backlog | 15 | Needs a dedicated rules primitive and scenario tests |
| 702.193 | Power-up | backlog | 49 | Needs a dedicated rules primitive and scenario tests |
| 702.194 | Teamwork | backlog | 20 | Needs a dedicated rules primitive and scenario tests |
| 702.195 | Storied | backlog | 13 | Needs a dedicated rules primitive and scenario tests |
