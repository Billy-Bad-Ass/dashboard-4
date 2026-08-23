/**
 * Test bootstrap.
 *
 * Registers the resolution hook that lets `node --test` load the app's
 * TypeScript source directly — see tests/resolve-hook.mjs for why the hook is
 * needed at all. Node 22's built-in type stripping does the rest, so there is
 * no compile step and no build artefacts to go stale between edit and test.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./resolve-hook.mjs', pathToFileURL('./tests/'));
