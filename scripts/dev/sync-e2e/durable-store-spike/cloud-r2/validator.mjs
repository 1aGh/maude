import { createContractValidator } from '../../contracts/validate.mjs';
import * as compiled from './dist/validators.mjs';

// Uses the same exact wire checks and semantics, with build-time Ajv compilation.
// No eval/new Function or Node-side prevalidation is needed by the deployed runtime.
class PrecompiledAjv {
  compile(schema) {
    const slug = schema.$id.split('/').at(-1);
    const fn = compiled[slug === 'limits' ? 'limitsSchema' : slug];
    if (!fn) throw new Error('uncompiled-contract');
    return fn;
  }
}
export const validator = createContractValidator(PrecompiledAjv);
