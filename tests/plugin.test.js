// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { build, createServer } from 'vite';
import react from '@vitejs/plugin-react';
import amalgam from '../js/vite.js';
import packagedAmalgam from '../dist/vite-plugin.js';

const root = process.cwd();
const fixtures = new Set();

function createFixture() {
  const directory = mkdtempSync(join(root, '.tmp-amalgam-'));
  fixtures.add(directory);
  const viewsPath = join(directory, 'views');
  mkdirSync(viewsPath, { recursive: true });
  return { directory, viewsPath };
}

function writeBlade(viewsPath, code, type = 'jsx') {
  const path = join(viewsPath, 'example.blade.php');
  writeFileSync(path, `<script editor type="${type}">\n${code}\n</script>`);
  return path;
}

function scriptModuleId(bladePath) {
  return `${relative(root, bladePath).replace(/\.blade\.php$/, '.tsx')}?amalgam`;
}

function findJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findJavaScriptFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

afterEach(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
  fixtures.clear();
});

describe('React import injection', () => {
  it('injects configured names and aliases without parsing script bindings', () => {
    const { viewsPath } = createFixture();
    const bladePath = writeBlade(viewsPath, `
import { ServerPreview } from 'amalgam/editor';
import { AdditionalEditContent } from 'amalgam/editor';
import { Other } from '@project/editor';
registerBlockEdit('acme/banner', () => <><ServerPreview /><AdditionalEditContent /><Icon /><Other /></>);
`);
    const plugin = amalgam({
      viewsPath,
      watchFiles: false,
      reactImports: [
        { from: 'amalgam/editor', named: ['ServerPreview', 'registerBlockEdit'] },
        { from: '@project/editor', named: [{ imported: 'ThemeIcon', local: 'Icon' }] },
      ],
    });
    const code = plugin.load(scriptModuleId(bladePath));

    expect(code.match(/ServerPreview/g)).toHaveLength(3);
    expect(code).toContain('import { ServerPreview, registerBlockEdit } from "amalgam/editor";');
    expect(code).toContain('import { ThemeIcon as Icon } from "@project/editor";');
    expect(code.match(/import \{ ServerPreview \} from/g)).toHaveLength(1);
    expect(code.match(/import \{ AdditionalEditContent \}/g)).toHaveLength(1);
  });

  it('injects configured imports even when the script already binds the same name', () => {
    const { viewsPath } = createFixture();
    const declared = writeBlade(viewsPath, 'const ThemeIcon = () => null;');
    const plugin = amalgam({
      viewsPath,
      watchFiles: false,
      reactImports: [{ from: '@project/editor', named: [{ imported: 'ThemeIcon', local: 'ThemeIcon' }] }],
    });
    expect(plugin.load(scriptModuleId(declared))).toContain('import { ThemeIcon } from "@project/editor";');

    const imported = writeBlade(viewsPath, "import { ThemeIcon } from '@other/editor';");
    expect(plugin.load(scriptModuleId(imported))).toContain('import { ThemeIcon } from "@project/editor";');
  });

  it('fails early for invalid import configuration', () => {
    expect(() => amalgam({ reactImports: [{ from: '', named: [] }] })).toThrow(/from must be a non-empty/);
    expect(() => amalgam({ reactImports: [{ from: 'pkg', named: ['not-valid-name'] }] })).toThrow(/invalid imported name/);
  });

  it('leaves non-React scripts untouched and does not inject React imports', () => {
    const { viewsPath } = createFixture();
    const bladePath = writeBlade(viewsPath, 'console.log("plain");', 'js');
    const plugin = amalgam({
      viewsPath,
      watchFiles: false,
      reactImports: [{ from: '@project/editor', named: ['Icon'] }],
    });
    const code = plugin.load(scriptModuleId(bladePath).replace(/\.tsx\?/, '.ts?'));

    expect(code).not.toContain('@project/editor');
    expect(code).toBe('console.log("plain");');
  });
});

describe('public alias resolution', () => {
  it('resolves the editor identifier through Vite development plugin hooks', async () => {
    const { directory, viewsPath } = createFixture();
    const server = await createServer({
      configFile: false,
      root: directory,
      plugins: [amalgam({ viewsPath, watchFiles: false })],
      server: { middlewareMode: true },
      appType: 'custom',
    });

    try {
      const resolved = await server.pluginContainer.resolveId('amalgam/editor');
      expect(resolved.id).toBe(fileURLToPath(new URL('../js/amalgam.jsx', import.meta.url)));
      expect(await server.pluginContainer.resolveId('amalgam')).toEqual(resolved);
    } finally {
      await server.close();
    }
  });

  it('builds a Blade React fixture using the public and configured imports', async () => {
    const { directory, viewsPath } = createFixture();
    const bladePath = writeBlade(viewsPath, `
registerBlockEdit('acme/banner', (props) => (
  <><ServerPreview {...props} /><Icon /></>
));
`);
    const entry = join(directory, 'entry.js');
    const icon = join(directory, 'editor.js');
    const output = join(directory, 'build');
    writeFileSync(entry, "import 'virtual:amalgam';\n");
    writeFileSync(icon, 'export function ThemeIcon() { return null; }\n');

    await build({
      configFile: false,
      root,
      plugins: [
        react(),
        packagedAmalgam({
          viewsPath,
          watchFiles: false,
          reactImports: [
            { from: 'amalgam/editor', named: ['ServerPreview', 'registerBlockEdit'] },
            { from: '@project/editor', named: [{ imported: 'ThemeIcon', local: 'Icon' }] },
          ],
        }),
      ],
      resolve: { alias: { '@project/editor': icon } },
      build: {
        outDir: output,
        emptyOutDir: true,
        rollupOptions: {
          input: entry,
          external: [/^react(?:\/|$)/, /^@wordpress\//],
        },
      },
    });

    const bundles = findJavaScriptFiles(output);
    expect(bundles.length).toBeGreaterThan(0);
    expect(existsSync(bladePath)).toBe(true);
    const bundle = bundles.map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(bundle).toContain('blocks.registerBlockType');
    expect(bundle).toContain('@wordpress/element');
    expect(bundle).toMatch(/react\/jsx(?:-dev)?-runtime/);
    expect(bundle).not.toContain('react-jsx-dev-runtime.development.js');
  });
});
