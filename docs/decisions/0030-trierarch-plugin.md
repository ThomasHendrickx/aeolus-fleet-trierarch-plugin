# 0030 Trierarch plugin: a ship of the fleet that brings in machines and assigns crews

- The trierarch plugin (`@aeolus-fleet/trierarch-plugin`) is the trierarchs' plugin on the server side, optional like squadrons (0017): its own process, hosted beside squadrons, reaching each fleet only through the public API as a ship with `fleet:read`, `fleet:manage`, `crew:assign`, and the label scopes once labels exist. On or off per hosted fleet by squadrons' mechanism (0021); self-hosters import it or not. Aeolus knows nothing about it beyond its ship.
- No database of its own in the first version, a choice for now, not a rule: its state lives in the fleet. It follows the fleet's changes, and every check-in returns the latest full state, so a missed event never leaves it stale.
- Machines join through it: it commissions each trierarch's ship (with `crew:run`) and gives the operator its starting prompt for `aeolus-trierarch init`. It labels each machine from what its trierarch reports.
- It serves unassigned crew requests (0029) oldest first and assigns each to one trierarch by optimistic claim: of those that fit (repository, harness, model) and have room, the one with the most room as a percentage, then the oldest. Strategies to change this come later. The operator does not pick.
- A request no trierarch can take gets the reason written on it, shown in the operator's needs-crew to-do.
- A machine is silent when its trierarch's last seen is older than a threshold, flagged on the machines page and in needs attention. Nothing is reassigned automatically.
- The console reads crew requests and their status from the fleet, and the trierarchs (capacity, what they offer) from the trierarch plugin.

Why: the fleet holds the declared state; one plugin schedules by shared-state optimistic claiming, never bidding, and each machine only runs what it is given. The trierarch plugin will grow, so it gets its own process and package from the start.

Rejected: placement inside the server; machines registering or labelling themselves (a machine would enforce plugin policy on its own); automatic reassignment of a silent machine's ships; plugins that know each other (squadrons only touches ships).
