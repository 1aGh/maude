// json-schema-lite.mjs — a zero-dependency validator for the JSON Schema (draft 2020-12) SUBSET
// Maude's own format schemas use (contract V2-1.11 §5.2, V2-1.18 §5.2). The hooks run in-process
// under node with no helper staging (decision v2-2.4b-hook-node-guard), so they cannot load Ajv;
// this lets the hook and `maude design check` validate a hand-off or a `.meta.json` against the
// schema FILE itself — one source, no second hand-written validator.
//
//   compileSchema(schema, { ref? }) → (value) => Array<{ path, keyword, message }>   ([] = valid)
//
// Fail closed on the schema, never on the data: a keyword outside SUPPORTED throws at compile time
// (so a schema can't silently grow a rule this validator ignores), and validating never throws.
// Semantics match Ajv 2020 for every supported keyword — test/schema-drift.test.ts runs a corpus
// through both and asserts the same verdicts. Annotation keywords (title, description, default,
// examples, format, $comment) are accepted and ignored, exactly as Ajv does without ajv-formats.
//
// Leaf module: no imports.

const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  '$comment',
  '$defs',
  'title',
  'description',
  'default',
  'examples',
  'format',
  'deprecated',
  'readOnly',
]);
const SUPPORTED = new Set([
  ...ANNOTATIONS,
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  '$ref',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
]);

const MAX_ERRORS = 50;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(v, t) {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeOf(v) === t;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** Unicode code points, as Ajv's ucs2length counts them. */
const strLen = (s) => [...s].length;

const esc = (k) => String(k).replaceAll('~', '~0').replaceAll('/', '~1');

/** Walk `schema` once: every keyword must be supported; every `pattern` must compile. */
function lint(schema, at, root) {
  if (typeof schema === 'boolean') return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error(`json-schema-lite: ${at || '#'} is not a schema`);
  for (const k of Object.keys(schema)) {
    if (!SUPPORTED.has(k))
      throw new Error(`json-schema-lite: unsupported keyword "${k}" at ${at || '#'}`);
  }
  if (schema.pattern !== undefined) new RegExp(schema.pattern, 'u');
  if (schema.$ref !== undefined) resolveRef(root, schema.$ref);
  for (const k of ['properties', '$defs'])
    for (const [n, s] of Object.entries(schema[k] ?? {})) lint(s, `${at}/${k}/${n}`, root);
  for (const k of ['oneOf', 'anyOf', 'allOf'])
    (schema[k] ?? []).forEach((s, i) => {
      lint(s, `${at}/${k}/${i}`, root);
    });
  for (const k of ['items', 'not', 'propertyNames'])
    if (schema[k] !== undefined) lint(schema[k], `${at}/${k}`, root);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean')
    lint(schema.additionalProperties, `${at}/additionalProperties`, root);
}

function resolveRef(root, ref) {
  if (ref === '#') return root;
  if (!ref.startsWith('#/'))
    throw new Error(`json-schema-lite: only local $ref is supported (${ref})`);
  let cur = root;
  for (const seg of ref.slice(2).split('/')) {
    const key = decodeURIComponent(seg).replaceAll('~1', '/').replaceAll('~0', '~');
    if (!cur || typeof cur !== 'object' || !Object.hasOwn(cur, key))
      throw new Error(`json-schema-lite: unresolved $ref ${ref}`);
    cur = cur[key];
  }
  return cur;
}

export function compileSchema(rootSchema, { ref } = {}) {
  lint(rootSchema, '', rootSchema);
  const entry = ref ? resolveRef(rootSchema, ref) : rootSchema;
  const regexCache = new Map();
  const re = (p) => {
    let r = regexCache.get(p);
    if (!r) {
      r = new RegExp(p, 'u');
      regexCache.set(p, r);
    }
    return r;
  };

  function run(schema, v, path, errs) {
    if (errs.length >= MAX_ERRORS) return;
    if (schema === true) return;
    if (schema === false) {
      errs.push({ path, keyword: 'false schema', message: 'is not allowed here' });
      return;
    }
    const push = (keyword, message) => {
      if (errs.length < MAX_ERRORS) errs.push({ path, keyword, message });
    };
    if (schema.$ref !== undefined) run(resolveRef(rootSchema, schema.$ref), v, path, errs);
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => matchesType(v, t))) {
        push('type', `must be ${types.join(' or ')}`);
        return;
      }
    }
    if (schema.const !== undefined && !deepEqual(v, schema.const))
      push('const', `must be ${JSON.stringify(schema.const)}`);
    if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(v, e)))
      push('enum', `must be one of ${JSON.stringify(schema.enum)}`);
    if (typeof v === 'string') {
      if (schema.minLength !== undefined && strLen(v) < schema.minLength)
        push('minLength', `must have at least ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && strLen(v) > schema.maxLength)
        push('maxLength', `must have at most ${schema.maxLength} characters`);
      if (schema.pattern !== undefined && !re(schema.pattern).test(v))
        push('pattern', `must match ${schema.pattern}`);
    }
    if (typeof v === 'number') {
      if (schema.minimum !== undefined && v < schema.minimum)
        push('minimum', `must be ≥ ${schema.minimum}`);
      if (schema.maximum !== undefined && v > schema.maximum)
        push('maximum', `must be ≤ ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && v <= schema.exclusiveMinimum)
        push('exclusiveMinimum', `must be > ${schema.exclusiveMinimum}`);
      if (schema.exclusiveMaximum !== undefined && v >= schema.exclusiveMaximum)
        push('exclusiveMaximum', `must be < ${schema.exclusiveMaximum}`);
    }
    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems)
        push('minItems', `must have at least ${schema.minItems} items`);
      if (schema.maxItems !== undefined && v.length > schema.maxItems)
        push('maxItems', `must have at most ${schema.maxItems} items`);
      if (schema.uniqueItems === true) {
        for (let i = 0; i < v.length; i++)
          for (let j = i + 1; j < v.length; j++)
            if (deepEqual(v[i], v[j])) {
              push('uniqueItems', `must not repeat items (${i} and ${j} are equal)`);
              i = v.length;
              break;
            }
      }
      if (schema.items !== undefined)
        for (let i = 0; i < v.length; i++) run(schema.items, v[i], `${path}/${i}`, errs);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties)
        push('minProperties', `must have at least ${schema.minProperties} properties`);
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
        push('maxProperties', `must have at most ${schema.maxProperties} properties`);
      for (const r of schema.required ?? [])
        if (!Object.hasOwn(v, r)) push('required', `must have required property "${r}"`);
      const props = schema.properties ?? {};
      for (const k of keys) {
        const p = `${path}/${esc(k)}`;
        if (schema.propertyNames !== undefined) {
          const sub = [];
          run(schema.propertyNames, k, p, sub);
          if (sub.length) push('propertyNames', `has an invalid property name "${k}"`);
        }
        if (Object.hasOwn(props, k)) run(props[k], v[k], p, errs);
        else if (schema.additionalProperties === false) {
          if (errs.length < MAX_ERRORS)
            errs.push({
              path: p,
              keyword: 'additionalProperties',
              message: `is not a known field ("${k}")`,
            });
        } else if (
          schema.additionalProperties !== undefined &&
          schema.additionalProperties !== true
        )
          run(schema.additionalProperties, v[k], p, errs);
      }
    }
    if (schema.allOf) for (const s of schema.allOf) run(s, v, path, errs);
    if (schema.anyOf && !schema.anyOf.some((s) => ok(s, v, path)))
      push('anyOf', 'must match one of the allowed shapes');
    if (schema.oneOf) {
      const n = schema.oneOf.filter((s) => ok(s, v, path)).length;
      if (n !== 1)
        push(
          'oneOf',
          n === 0 ? 'must match one of the allowed shapes' : 'matches more than one shape'
        );
    }
    if (schema.not !== undefined && ok(schema.not, v, path))
      push('not', 'must not match the excluded shape');
  }

  function ok(schema, v, path) {
    const sub = [];
    run(schema, v, path, sub);
    return sub.length === 0;
  }

  return (value) => {
    const errs = [];
    try {
      run(entry, value, '', errs);
    } catch (e) {
      errs.push({
        path: '',
        keyword: 'internal',
        message: `the validator failed: ${e?.message ?? e}`,
      });
    }
    return errs;
  };
}
