import { trierarchNameSchema, type PluginCallContext } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { createManageRepositories } from '../../core/repositories/manage-repositories.js';

const list = z.strictObject({});
const add = z.strictObject({ name: trierarchNameSchema, url: z.string(), expectedVersion: z.number().int().nonnegative() });
const remove = z.strictObject({ name: trierarchNameSchema, expectedVersion: z.number().int().nonnegative() });
const refusal = (code: 'BAD_REQUEST' | 'FORBIDDEN' | 'CONFLICT') => ({ error: { data: { code } } });

/** Only operations admitted by the plugin actor contract are exposed here. */
export function createRepositoryProcedures(manage: ReturnType<typeof createManageRepositories>) {
  return {
    'repositories.list': async (context: PluginCallContext) => {
      if (!list.safeParse(context.input).success) return refusal('BAD_REQUEST');
      const result = await manage.list(context);
      return result.isOk ? { result: { data: result.value } } : refusal('FORBIDDEN');
    },
    'repositories.add': async (context: PluginCallContext) => {
      const input = add.safeParse(context.input);
      if (!input.success) return refusal('BAD_REQUEST');
      const result = await manage.change(context, { kind: 'add', ...input.data });
      if (result.isOk) return { result: { data: result.value } };
      return refusal(result.error.reason === 'forbidden' ? 'FORBIDDEN' : result.error.reason.includes('conflict') ? 'CONFLICT' : 'BAD_REQUEST');
    },
    'repositories.remove': async (context: PluginCallContext) => {
      const input = remove.safeParse(context.input);
      if (!input.success) return refusal('BAD_REQUEST');
      const result = await manage.change(context, { kind: 'remove', ...input.data });
      if (result.isOk) return { result: { data: result.value } };
      return refusal(result.error.reason === 'forbidden' ? 'FORBIDDEN' : 'CONFLICT');
    },
  };
}
