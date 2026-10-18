/**
 * `@aeolus-fleet/trierarch-plugin/testing`: what core's end-to-end tests need to run
 * the trierarch plugin beside the console in their own process (decision 0049): the app
 * and its database in core's shared Postgres container.
 */
export { createTrierarchPluginApp, type TrierarchPluginApp } from '../app.js';
export { createPluginDatabase } from './database.js';
