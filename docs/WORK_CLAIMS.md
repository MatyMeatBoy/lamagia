# Cooperative work claims

| Cluster | Worker branch | Scope | Status |
| --- | --- | --- | --- |
| `rules-equipment` | `codex/c13-equipment-cluster` | Equip, attachment, Equipment static bonuses, and Sword of the Paruns untap abilities | Ready for integrator review |
| `rules-level-up` | `codex/c13-equipment-cluster` | Level up activation, level counters, and level-band P/T/keyword characteristics | Ready for integrator review |
| `rules-tap-untap` | `codex/c13-equipment-cluster` | Targeted Tap target creature and Untap target permanent effects | Ready for integrator review |
| `rules-mill` | `codex/c13-equipment-cluster` | Target player mills a bounded number of cards into their graveyard | Ready for integrator review |
| `rules-counter-restrictions` | `codex/c13-equipment-cluster` | Creature-spell and noncreature-spell counter target families | Ready for integrator review |
| `rules-plus-counters` | `codex/c13-equipment-cluster` | Put +1/+1 or -1/-1 counters on a target creature | Ready for integrator review |
| `rules-target-discard` | `codex/c13-equipment-cluster` | Target-player discard with an explicit hand-card choice | Ready for integrator review |
| `rules-life-gained` | `codex/c13-equipment-cluster` | Life-gained trigger event and source +1/+1/-1/-1 counter effect | Ready for integrator review |
| `rules-target-life` | `codex/c13-equipment-cluster` | Target-player life gain with event propagation | Ready for integrator review |
| `rules-each-life` | `codex/c13-equipment-cluster` | Living-player life gain with one event per recipient | Ready for integrator review |
| `rules-target-life-loss` | `codex/c13-equipment-cluster` | Target-player life loss, distinct from damage | Ready for integrator review |
| `rules-each-life-loss` | `codex/c13-equipment-cluster` | Living-player global life loss, distinct from damage | Ready for integrator review |
| `rules-self-life-loss` | `codex/c13-equipment-cluster` | Controller life loss, distinct from damage | Ready for integrator review |
| `rules-life-lost-trigger` | `codex/c13-equipment-cluster` | Life-lost event bus for effects and damage | Ready for integrator review |
| `rules-token-creation` | `codex/c13-equipment-cluster` | Token creation preserves tapped state for C13 token family | Ready for integrator review |
| `rules-graveyard-return` | `codex/c13-equipment-cluster` | Targeted creature-card return from own graveyard to hand | Ready for integrator review |
| `rules-combat-damage-any-creature` | `codex/c13-equipment-cluster` | Combat-damage trigger for any creature source | Ready for integrator review |
| `rules-token-scaling` | `codex/c13-equipment-cluster` | Token creation scaled by lands controlled | Ready for integrator review |
| `rules-subtype-counters` | `codex/c13-equipment-cluster` | Counters on all controlled creatures of a subtype | Ready for integrator review |
| `rules-graveyard-exile` | `codex/c13-equipment-cluster` | Exile a targeted card from own graveyard | Ready for integrator review |
| `rules-x-opponent-loss` | `codex/c13-equipment-cluster` | X-scaled life loss for each opponent | Ready for integrator review |
| `rules-x-draw` | `codex/c13-equipment-cluster` | X-scaled self draw effect | Ready for integrator review |
| `rules-each-opponent-mill` | `codex/c13-equipment-cluster` | Global mill for each opponent | Ready for integrator review |
| `rules-each-opponent-draw` | `codex/c13-equipment-cluster` | Global draw for each opponent | Ready for integrator review |
| `rules-graveyard-library-top` | `codex/c13-equipment-cluster` | Return own graveyard card to library top | Ready for integrator review |
| `rules-all-creature-counters` | `codex/c13-equipment-cluster` | Counters on all creatures controlled by the caster | Ready for integrator review |
| `rules-creature-spell-trigger` | `codex/c13-equipment-cluster` | Creature-spell filter for cast triggers | Ready for integrator review |
| `rules-x-discard` | `codex/c13-equipment-cluster` | X-scaled private discard choices | Ready for integrator review |

Workers must claim a disjoint primitive or card batch before editing. The
integrator owns merge order and reruns coverage after each accepted commit.
