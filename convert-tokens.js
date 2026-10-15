/**
 * ============================================================================
 * DESIGN SYSTEM TOKEN CONVERTER (JSON -> CSS Custom Properties)
 * ============================================================================
 * 
 * This script transforms design tokens exported from Figma / Design Token tools
 * (e.g. `design-tokens.tokens.json`) into production-ready CSS variables.
 * 
 * ARCHITECTURE PRINCIPLES:
 * 1. Primitive Tokens (--primitive-*):
 *    - The foundational palette and scales (e.g. key colors, 0-100 tonal steps).
 *    - [GOVERNANCE] DO NOT apply primitives directly to UI components.
 * 
 * 2. Semantic Color Roles (--color-*):
 *    - The functional layer representing intent (primary, on-primary, surface, etc.).
 *    - [USAGE] Directly applied to UI components.
 *    - Color roles reference primitive variables (e.g. var(--primitive-primary-40)).
 *    - Swapped automatically between Light and Dark themes.
 * 
 * @module convert-tokens
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const DEFAULT_INPUT_FILE = path.join(__dirname, 'design-tokens.tokens.json');
const DEFAULT_OUTPUT_FILE = path.join(__dirname, 'tokens.css');

/**
 * Material Design 3 standard tonal mapping for Dark Theme color roles.
 * Maps role names to primitive palette steps.
 */
const DARK_THEME_ROLE_MAPPING = {
  // Primary
  'primary': '--primitive-primary-80',
  'on primary': '--primitive-primary-20',
  'primary container': '--primitive-primary-30',
  'on primary container': '--primitive-primary-90',

  // Secondary
  'secondary': '--primitive-secondary-80',
  'on secondary': '--primitive-secondary-20',
  'secondary container': '--primitive-secondary-30',
  'on secondary container': '--primitive-secondary-90',

  // Tertiary
  'tertiary': '--primitive-tertiary-80',
  'on tertiary': '--primitive-tertiary-20',
  'tertiary container': '--primitive-tertiary-30',
  'on tertiary container': '--primitive-tertiary-90',

  // Error
  'error': '--primitive-error-80',
  'on error': '--primitive-error-20',
  'error container': '--primitive-error-30',
  'on error container': '--primitive-error-90',

  // Surface & Background
  'surface color': '--primitive-neutral-10',
  'on surface': '--primitive-neutral-90',
  'surface variant': '--primitive-neutral-variant-30',
  'on surface variant': '--primitive-neutral-variant-80',

  // Surface Containers (Dark Theme Elevation)
  'surface container lowest': '--primitive-neutral-0',
  'surface container low': '--primitive-neutral-10',
  'surface container': '--primitive-neutral-20',
  'surface container high': '--primitive-neutral-20',
  'surface container highest': '--primitive-neutral-30',

  // Inverse
  'inverse surface': '--primitive-neutral-90',
  'inverse on surface': '--primitive-neutral-20',

  // Surface Tint
  'surface tint': '--primitive-primary-80',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert string to kebab-case
 * @param {string} str 
 * @returns {string}
 */
function toKebabCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

/**
 * Normalizes hex colors. If an 8-character hex has an alpha of 'ff',
 * simplify it to standard 6-character hex (e.g. #004ed4ff -> #004ed4).
 * @param {string} hex 
 * @returns {string}
 */
function normalizeColor(hex) {
  if (typeof hex !== 'string') return hex;
  const cleanHex = hex.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(cleanHex) && cleanHex.toLowerCase().endsWith('ff')) {
    return cleanHex.slice(0, 7).toLowerCase();
  }
  return cleanHex.toLowerCase();
}

/**
 * Converts a drop shadow token definition to a valid CSS box-shadow value.
 * @param {object} shadowObj 
 * @returns {string}
 */
function formatBoxShadow(shadowObj) {
  const { offsetX = 0, offsetY = 0, radius = 0, spread = 0, color = '#000000' } = shadowObj;
  return `${offsetX}px ${offsetY}px ${radius}px ${spread}px ${color}`;
}

/**
 * Resolves a token reference path like:
 *   "{primitives colors.primary color palette.primary90}"
 * into its corresponding CSS variable name:
 *   "--primitive-primary-90"
 * 
 * @param {string} refStr 
 * @returns {string} CSS variable name (without var())
 */
function resolveTokenRefToVariableName(refStr) {
  const clean = refStr.replace(/^\{|\}$/g, '').trim();
  const parts = clean.split('.');

  if (parts.length >= 3) {
    const section = parts[0]; // "primitives colors"
    const group = parts[1];   // "key color group", "primary color palette", etc.
    const token = parts[2];   // "primary key color", "primary90", etc.

    if (section === 'primitives colors') {
      if (group === 'key color group') {
        const keyName = token.replace(' key color', '');
        return `--primitive-key-${toKebabCase(keyName)}`;
      }

      // Palettes like "primary color palette" -> "primary", "neutral variant color palette" -> "neutral-variant"
      const paletteMatch = group.match(/^([a-z\s]+)\s+color\s+palette$/i);
      const palettePrefix = paletteMatch ? toKebabCase(paletteMatch[1]) : toKebabCase(group);

      // Extract step number or name, e.g. "primary90" -> "90", "neutralvariant90" -> "90"
      const stepMatch = token.match(/(\d+)$/);
      if (stepMatch) {
        return `--primitive-${palettePrefix}-${stepMatch[1]}`;
      }

      return `--primitive-${palettePrefix}-${toKebabCase(token)}`;
    }
  }

  return `--${toKebabCase(clean.replace(/\./g, '-'))}`;
}

// ============================================================================
// TOKEN PARSERS & GENERATORS
// ============================================================================

/**
 * Generates primitive color variables (key colors and palette tonal steps).
 * @param {object} primitives 
 * @returns {string[]} Array of CSS declarations
 */
function generatePrimitiveColorsCSS(primitives) {
  const lines = [];

  // 1. Key Colors
  if (primitives['key color group']) {
    lines.push('  /* --- Key Color Seeds --- */');
    for (const [key, item] of Object.entries(primitives['key color group'])) {
      const name = key.replace(' key color', '');
      const varName = `--primitive-key-${toKebabCase(name)}`;
      const val = normalizeColor(item.value);
      lines.push(`  ${varName}: ${val};`);
    }
    lines.push('');
  }

  // 2. Tonal Palettes
  for (const [paletteKey, paletteData] of Object.entries(primitives)) {
    if (paletteKey === 'key color group') continue;

    const paletteMatch = paletteKey.match(/^([a-z\s]+)\s+color\s+palette$/i);
    const paletteName = paletteMatch ? paletteMatch[1].trim() : paletteKey;
    const paletteSlug = toKebabCase(paletteName);

    lines.push(`  /* --- Primitive Palette: ${paletteName.toUpperCase()} --- */`);

    for (const [stepKey, item] of Object.entries(paletteData)) {
      const stepMatch = stepKey.match(/(\d+)$/);
      const step = stepMatch ? stepMatch[1] : toKebabCase(stepKey);
      const varName = `--primitive-${paletteSlug}-${step}`;
      const val = normalizeColor(typeof item === 'object' && item.value !== undefined ? item.value : item);
      lines.push(`  ${varName}: ${val};`);
    }
    lines.push('');
  }

  return lines;
}

/**
 * Generates semantic color role variables for Light Theme.
 * Color roles reference primitive variables using `var(...)`.
 * @param {object} colorRoles 
 * @param {string} [indent='  '] Indentation string
 * @returns {string[]} Array of CSS declarations
 */
function generateLightColorRolesCSS(colorRoles, indent = '  ') {
  const lines = [];

  for (const [roleKey, roleItem] of Object.entries(colorRoles)) {
    const roleVarName = `--color-${toKebabCase(roleKey)}`;
    const rawVal = typeof roleItem === 'object' && roleItem.value !== undefined ? roleItem.value : roleItem;

    if (typeof rawVal === 'string' && rawVal.startsWith('{') && rawVal.endsWith('}')) {
      const primitiveVar = resolveTokenRefToVariableName(rawVal);
      lines.push(`${indent}${roleVarName}: var(${primitiveVar});`);
      if (roleKey === 'surface color') {
        // Provide standard shorthand alias `--color-surface`
        lines.push(`${indent}--color-surface: var(${roleVarName});`);
      }
    } else {
      lines.push(`${indent}${roleVarName}: ${normalizeColor(rawVal)};`);
      if (roleKey === 'surface color') {
        lines.push(`${indent}--color-surface: var(${roleVarName});`);
      }
    }
  }

  return lines;
}

/**
 * Generates semantic color role variables for Dark Theme.
 * Mapped using standard Material Design 3 tonal hierarchy.
 * @param {object} colorRoles 
 * @param {string} [indent='  '] Indentation string
 * @returns {string[]} Array of CSS declarations
 */
function generateDarkColorRolesCSS(colorRoles, indent = '  ') {
  const lines = [];

  for (const roleKey of Object.keys(colorRoles)) {
    const roleVarName = `--color-${toKebabCase(roleKey)}`;
    const darkTarget = DARK_THEME_ROLE_MAPPING[roleKey];

    if (darkTarget) {
      lines.push(`${indent}${roleVarName}: var(${darkTarget});`);
      if (roleKey === 'surface color') {
        lines.push(`${indent}--color-surface: var(${roleVarName});`);
      }
    } else {
      // Fallback: keep role value if not specifically overridden
      const rawVal = colorRoles[roleKey].value;
      if (typeof rawVal === 'string' && rawVal.startsWith('{')) {
        const primitiveVar = resolveTokenRefToVariableName(rawVal);
        lines.push(`${indent}${roleVarName}: var(${primitiveVar});`);
      } else {
        lines.push(`${indent}${roleVarName}: ${normalizeColor(rawVal)};`);
      }
      if (roleKey === 'surface color') {
        lines.push(`${indent}--color-surface: var(${roleVarName});`);
      }
    }
  }

  return lines;
}

/**
 * Generates spacing CSS variables.
 * @param {object} spacingCollection 
 * @returns {string[]} Array of CSS declarations
 */
function generateSpacingCSS(spacingCollection) {
  const lines = [];
  lines.push('  /* --- Spacing Scale --- */');

  for (const [key, item] of Object.entries(spacingCollection)) {
    const val = typeof item === 'object' && item.value !== undefined ? item.value : item;
    const cleanKey = key.replace(/\s+spacing$/i, '');
    const varName = `--spacing-${toKebabCase(cleanKey)}`;
    const formattedVal = val === 0 ? '0px' : `${val}px`;
    lines.push(`  ${varName}: ${formattedVal};`);

    // Convenience aliases
    if (cleanKey === 'no') {
      lines.push(`  --spacing-none: 0px;`);
    }
  }

  return lines;
}

/**
 * Generates shadow / effect CSS variables.
 * @param {object} effects 
 * @returns {string[]} Array of CSS declarations
 */
function generateEffectsCSS(effects) {
  const lines = [];
  lines.push('  /* --- Shadows & Elevation --- */');

  for (const [key, item] of Object.entries(effects)) {
    const shadowVal = item.value;
    const varName = `--shadow-${toKebabCase(key.replace(/\s+shadow$/i, ''))}`;
    const formatted = formatBoxShadow(shadowVal);
    lines.push(`  ${varName}: ${formatted};`);
  }

  return lines;
}

/**
 * Generates typography CSS variables and helper utility classes.
 * @param {object} typography 
 * @returns {{ vars: string[], classes: string[] }}
 */
function generateTypographyCSS(typography) {
  const vars = [];
  const classes = [];

  vars.push('  /* --- Typography --- */');

  for (const [styleName, props] of Object.entries(typography)) {
    const slug = toKebabCase(styleName);
    const fontSize = props.fontSize?.value || 16;
    const lineHeight = props.lineHeight?.value || 24;
    const fontWeight = props.fontWeight?.value || 400;
    const fontFamily = props.fontFamily?.value ? `'${props.fontFamily.value}', sans-serif` : 'sans-serif';
    const letterSpacing = props.letterSpacing?.value !== undefined ? `${props.letterSpacing.value}px` : 'normal';

    vars.push(`  --font-${slug}-size: ${fontSize}px;`);
    vars.push(`  --font-${slug}-line-height: ${lineHeight}px;`);
    vars.push(`  --font-${slug}-weight: ${fontWeight};`);
    vars.push(`  --font-${slug}-letter-spacing: ${letterSpacing};`);
    vars.push(`  --font-${slug}-family: ${fontFamily};`);

    // Utility class
    classes.push(`.${slug} {`);
    classes.push(`  font-family: var(--font-${slug}-family);`);
    classes.push(`  font-size: var(--font-${slug}-size);`);
    classes.push(`  line-height: var(--font-${slug}-line-height);`);
    classes.push(`  font-weight: var(--font-${slug}-weight);`);
    classes.push(`  letter-spacing: var(--font-${slug}-letter-spacing);`);
    classes.push('}');
  }

  return { vars, classes };
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

/**
 * Reads token JSON and returns complete CSS stylesheet string.
 * @param {object} tokens 
 * @returns {string} Formatted CSS
 */
function convertTokensToCSS(tokens) {
  const timestamp = new Date().toISOString();
  const primitivesCSS = tokens['primitives colors'] ? generatePrimitiveColorsCSS(tokens['primitives colors']) : [];
  const spacingCSS = tokens['spacing collection'] ? generateSpacingCSS(tokens['spacing collection']) : [];
  const effectsCSS = tokens['effect'] ? generateEffectsCSS(tokens['effect']) : [];
  const typography = tokens['typography'] ? generateTypographyCSS(tokens['typography']) : { vars: [], classes: [] };
  const lightRolesCSS = tokens['color roles'] ? generateLightColorRolesCSS(tokens['color roles'], '  ') : [];
  const darkRolesCSS = tokens['color roles'] ? generateDarkColorRolesCSS(tokens['color roles'], '  ') : [];
  const darkRolesMediaCSS = tokens['color roles'] ? generateDarkColorRolesCSS(tokens['color roles'], '    ') : [];

  return `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS - GENERATED CSS VARIABLES
 * Generated on: ${timestamp}
 * ============================================================================
 * 
 * DESIGN SYSTEM RULES:
 * 1. PRIMITIVES (--primitive-*):
 *    Foundational color palette and scale definitions.
 *    [WARNING] NEVER apply primitive tokens directly to UI components.
 * 
 * 2. SEMANTIC ROLES (--color-*):
 *    Semantic color roles describing functional UI intent.
 *    [APPLY] ALWAYS use semantic roles in component stylesheets.
 *    Theme switching (Light/Dark) operates exclusively on these semantic roles.
 * ============================================================================
 */

/* ==========================================================================
   GLOBAL DESIGN TOKENS (PRIMITIVES, SPACING, SHADOWS, TYPOGRAPHY)
   ========================================================================== */
:root {
  /* ========================================================================
     1. FOUNDATION PRIMITIVES (DO NOT APPLY DIRECTLY TO UI)
     ======================================================================== */
${primitivesCSS.join('\n')}

  /* ========================================================================
     2. SPACING SCALE
     ======================================================================== */
${spacingCSS.join('\n')}

  /* ========================================================================
     3. SHADOWS & ELEVATION
     ======================================================================== */
${effectsCSS.join('\n')}

  /* ========================================================================
     4. TYPOGRAPHY SCALES
     ======================================================================== */
${typography.vars.join('\n')}
}

/* ==========================================================================
   COLOR ROLES: LIGHT THEME (DEFAULT)
   ==========================================================================
   Applied to :root by default and when [data-theme="light"] is active.
   ========================================================================== */
:root,
[data-theme="light"] {
${lightRolesCSS.join('\n')}
}

/* ==========================================================================
   COLOR ROLES: DARK THEME (MANUAL OVERRIDE)
   ==========================================================================
   Activate by setting: <html data-theme="dark"> or on any container element.
   ========================================================================== */
[data-theme="dark"] {
${darkRolesCSS.join('\n')}
}

/* ==========================================================================
   COLOR ROLES: DARK THEME (SYSTEM PREFERENCE)
   ==========================================================================
   Automatically switches to Dark Theme when the OS preference is dark,
   unless user explicitly forced light mode with [data-theme="light"].
   ========================================================================== */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${darkRolesMediaCSS.join('\n')}
  }
}

/* ==========================================================================
   TYPOGRAPHY UTILITY CLASSES (OPTIONAL HELPERS)
   ========================================================================== */
${typography.classes.join('\n\n')}
`;
}

/**
 * Main execution function
 * @param {string} inputPath 
 * @param {string} outputPath 
 */
function build(inputPath = DEFAULT_INPUT_FILE, outputPath = DEFAULT_OUTPUT_FILE) {
  try {
    console.log(`[Token Converter] Reading: ${inputPath}`);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input token file does not exist at: ${inputPath}`);
    }

    const rawData = fs.readFileSync(inputPath, 'utf8');
    const tokens = JSON.parse(rawData);

    console.log(`[Token Converter] Converting tokens...`);
    const cssContent = convertTokensToCSS(tokens);

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, cssContent, 'utf8');
    console.log(`[Token Converter] Successfully generated CSS variables!`);
    console.log(`[Token Converter] Output file: ${outputPath}`);
  } catch (err) {
    console.error(`[Token Converter] Error: ${err.message}`);
    process.exit(1);
  }
}

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  let input = DEFAULT_INPUT_FILE;
  let output = DEFAULT_OUTPUT_FILE;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      input = path.resolve(process.cwd(), args[++i]);
    } else if (args[i] === '--output' || args[i] === '-o') {
      output = path.resolve(process.cwd(), args[++i]);
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node convert-tokens.js [options]

Options:
  -i, --input <path>   Path to design-tokens.tokens.json (default: ./design-tokens.tokens.json)
  -o, --output <path>  Path to output CSS file (default: ./tokens.css)
  -h, --help           Show help
      `);
      process.exit(0);
    }
  }

  build(input, output);
}

module.exports = {
  build,
  convertTokensToCSS,
  generatePrimitiveColorsCSS,
  generateLightColorRolesCSS,
  generateDarkColorRolesCSS,
  DARK_THEME_ROLE_MAPPING,
  toKebabCase,
  normalizeColor,
  resolveTokenRefToVariableName
};
