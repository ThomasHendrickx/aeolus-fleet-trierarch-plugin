# 0030 Trierarch plugin: a ship of the fleet that brings in machines and assigns crews

- The trierarch plugin is optional, like squadrons (0017): its own process, hosted beside squadrons, reaching each fleet only through the public API as a ship with the scopes it needs (`fleet:manage`, `crew:assign` and the label scopes). On or off per hosted fleet, as squadrons is (0021); self-hosters import it or not. Aeolus knows nothing about it beyond its ship.
- Machines join through it: it commissions each trierarch's ship (with `crew:run`) and gives the operator its starting prompt for `aeolus-trierarch init`. It labels each machine from what its trierarch reports.
- It assigns each unassigned crew request (0029) to one trierarch by optimistic claim, from what each reports it can do: harness, workspace, room. The operator does not pick; labels steer placement later.
- A trierarch that goes silent with ships assigned is flagged for the operator. Nothing is reassigned automatically.
- The console reads crew requests and their status from the fleet, and the trierarchs (capacity, what they offer) from the plugin.

Why: the fleet holds the declared state; one plugin schedules by shared-state optimistic claiming, never bidding, and each machine only runs what it is given. The plugin will grow, so it gets its own process from the start.

Rejected: placement inside the server; machines registering or labelling themselves (a machine would enforce plugin policy on its own); automatic reassignment of a silent machine's ships; plugins that know each other (squadrons only touches ships).
