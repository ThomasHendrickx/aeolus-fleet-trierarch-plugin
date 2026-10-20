/** The scope namespace the trierarch plugin declares in each fleet it serves, and enforces itself (decision 0046). */
export const PLUGIN_NAMESPACE = 'trierarch';

/** Adding a computer: joining a machine's trierarch to the fleet (decision 0055). */
export const JOIN_SCOPE = 'trierarch:join';

/** The namespace's whole list, each with the one line `fleet.scopes` shows. */
export const PLUGIN_SCOPES: readonly { scope: string; description: string }[] = [{ scope: JOIN_SCOPE, description: 'Add a computer: join its trierarch to the fleet' }];
