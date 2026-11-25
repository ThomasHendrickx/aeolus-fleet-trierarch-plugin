/** Reads YAML using the same rule set schema as core and the trierarch. */
import { guardRuleSetSchema } from '@aeolus-fleet/common';
import { parseDocument } from 'yaml';

import type { GuardValidation } from '../../core/guard/ports.js';
import { err, ok } from '../../core/shared/result.js';

export const guardValidation: GuardValidation = {
  read(content) {
    let value: unknown;
    try {
      const document = parseDocument(content);
      if (document.errors.length > 0 || document.warnings.length > 0) {
        return err('rule set is not valid YAML');
      }
      value = document.toJS();
    } catch {
      return err('rule set is not valid YAML');
    }

    const parsed = guardRuleSetSchema.safeParse(value);
    if (!parsed.success) {
      return err('rule set does not match the guard schema');
    }
    return ok({ name: parsed.data.name, rules: parsed.data.rules ?? {} });
  },
};
