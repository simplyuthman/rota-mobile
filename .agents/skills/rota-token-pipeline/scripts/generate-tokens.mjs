#!/usr/bin/env node
// Converts the generated design-system CSS (tokens.css) into a typed TypeScript module.
// Usage: node generate-tokens.mjs <input.css> <output.ts>
// Never hand-edit the output. Re-run this script whenever tokens.css changes.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node generate-tokens.mjs <input.css> <output.ts>');
  process.exit(1);
}

const css = readFileSync(inputPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Split top-level rules with brace matching. @media (and other at-rules) are skipped:
// the system-preference dark block duplicates the [data-theme="dark"] block.
function topLevelRules(source) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) {
        selector = source.slice(start, i).trim();
        start = i + 1;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push({ selector, body: source.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return rules.filter((r) => !r.selector.startsWith('@'));
}

function declarations(body) {
  const vars = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const rules = topLevelRules(css);
const globalVars = {};
let lightVars = {};
let darkVars = {};
for (const { selector, body } of rules) {
  const vars = declarations(body);
  if (selector === ':root') Object.assign(globalVars, vars);
  else if (selector.includes('[data-theme="light"]')) lightVars = { ...lightVars, ...vars };
  else if (selector === '[data-theme="dark"]') darkVars = { ...darkVars, ...vars };
}
if (!Object.keys(lightVars).length || !Object.keys(darkVars).length) {
  console.error('Could not find both light and dark colour-role blocks.');
  process.exit(1);
}

function resolve(value, scope, trail = []) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    if (trail.includes(name)) throw new Error(`Circular token reference: ${[...trail, name].join(' -> ')}`);
    if (!(name in scope)) throw new Error(`Unresolved token reference: ${name}`);
    return resolve(scope[name], scope, [...trail, name]);
  });
}

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const px = (v) => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  if (!m) throw new Error(`Expected a px value, got "${v}"`);
  return Number(m[1]);
};

// --- primitives (internal; never import outside src/theme) ---
const primitives = {};
for (const [name, value] of Object.entries(globalVars)) {
  if (!name.startsWith('--primitive-')) continue;
  primitives[camel(name.replace('--primitive-', ''))] = value;
}

// --- spacing ---
const spacing = {};
for (const [name, value] of Object.entries(globalVars)) {
  if (name.startsWith('--spacing-')) spacing[camel(name.replace('--spacing-', ''))] = px(value);
}

// --- shadows ---
const shadows = {};
for (const [name, value] of Object.entries(globalVars)) {
  if (!name.startsWith('--shadow-')) continue;
  const m = /^(-?\d+)px\s+(-?\d+)px\s+(\d+)px\s+(-?\d+)px\s+(#[0-9a-fA-F]{6,8})$/.exec(value);
  if (!m) throw new Error(`Unrecognised shadow format for ${name}: ${value}`);
  shadows[camel(name.replace('--shadow-', ''))] = {
    offsetX: Number(m[1]), offsetY: Number(m[2]), blur: Number(m[3]), spread: Number(m[4]), color: m[5],
  };
}

// --- typography ---
const typography = {};
for (const [name, value] of Object.entries(globalVars)) {
  const m = /^--font-([a-z]+-[a-z]+)-(size|line-height|weight|letter-spacing|family)$/.exec(name);
  if (!m) continue;
  const role = camel(m[1]);
  typography[role] ??= {};
  const prop = camel(m[2]);
  if (prop === 'family') typography[role].family = value.split(',')[0].replace(/['"]/g, '').trim();
  else if (prop === 'weight') typography[role].weight = Number(value);
  else typography[role][prop] = px(value);
}

// --- colour roles per theme (var() chains fully resolved to hex) ---
function roles(themeVars) {
  const scope = { ...globalVars, ...themeVars };
  const out = {};
  for (const [name, value] of Object.entries(themeVars)) {
    if (!name.startsWith('--color-') || name === '--color-surface-color') continue;
    out[camel(name.replace('--color-', ''))] = resolve(value, scope);
  }
  return out;
}
const light = roles(lightVars);
const dark = roles(darkVars);

// Both themes must define exactly the same roles.
const lk = Object.keys(light).sort().join();
const dk = Object.keys(dark).sort().join();
if (lk !== dk) {
  console.error('Light and dark themes define different colour roles.');
  process.exit(1);
}

const json = (o) => JSON.stringify(o, null, 2);
const out = `// GENERATED FILE. DO NOT EDIT. Source: ${inputPath}
// Regenerate with: node .agents/skills/rota-token-pipeline/scripts/generate-tokens.mjs <css> <ts>
// Import only from src/theme (never from components or screens).

/** Foundation palette. INTERNAL: never use in a component. */
export const primitives = ${json(primitives)} as const;

export const spacing = ${json(spacing)} as const;

export const shadows = ${json(shadows)} as const;

export const typography = ${json(typography)} as const;

export const colorRoles = {
  light: ${json(light).replace(/\n/g, '\n  ')},
  dark: ${json(dark).replace(/\n/g, '\n  ')},
} as const;

export type ColorRole = keyof typeof colorRoles.light;
export type ThemeName = keyof typeof colorRoles;
export type SpacingToken = keyof typeof spacing;
export type ShadowToken = keyof typeof shadows;
export type TypographyRole = keyof typeof typography;
`;
writeFileSync(outputPath, out);
console.log(`Wrote ${outputPath}: ${Object.keys(primitives).length} primitives, ${Object.keys(spacing).length} spacing, ${Object.keys(shadows).length} shadows, ${Object.keys(typography).length} type roles, ${Object.keys(light).length} colour roles.`);
