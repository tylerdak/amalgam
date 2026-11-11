## Installation

Install Amalgam into your project using Composer:

```bash
composer require dakin/amalgam
```

Next, add the following lines to your `resources/js/app.js` file. Amalgam will compile all scripts extracted from your Blade files here.
The preamble bit is required for the React stuff.

```js
import '@vitejs/plugin-react/preamble';
import 'virtual:amalgam';
```

Finally, update your `vite.config.js` to register Amalgam and the React plugin:

```diff
import {
    defineConfig
} from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from "@tailwindcss/vite";
+ import react from '@vitejs/plugin-react';
+ import amalgam from './vendor/dakin/amalgam/dist/vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
        tailwindcss(),
+       amalgam(),
    ],
    server: {
        cors: true,
    },
});
```

## Quick guide

When ready, start your Vite development server:

```bash
npm run dev
```

### Creating a new component

Amalgam is intended to be used within Blade components. Create one in `resources/views/components`. You can use the following Acorn command:

```bash
wp acorn make:view components.alert
```

Then add a `<script editor type="jsx">` tag.

### `<script editor type="jsx">`

This is where you'll do any JS actions. This supports React, but you can also do vanilla JS stuff here. Amalgam’s Vite plugin will scan all Blade files within your `resources/views` directory, extract code from `<script editor>` tags and bundle it into a single JavaScript file. The script tags will never actually be rendered on the page.

```html
<!-- Run any block-specific JS you want -->
<script editor>
console.log('My vanilla JS')
</script>

<!-- Or use React to edit how your blocks work, for example  -->
<script editor type="jsx">
import { PanelBody } from '@wordpress/components';
import { InspectorControls } from '@wordpress/block-editor';

wp.blocks.registerBlockType('example/banner', {
  edit: () => (
    <InspectorControls>
      <PanelBody title="My Panel">
        <p>My content</p>
      </PanelBody>
    </InspectorControls>
  ),
});
</script>
```

> [!IMPORTANT]
> Since the code will get extracted into a JavaScript file, you cannot use Blade within the script tag.

### Imports

Since Amalgam compiles `<script editor>` tags with Vite, you can use any import supported in a JavaScript/TypeScript file:

```html
<script editor>
    // NPM module
    import { twMerge } from 'tailwind-merge'

    // Local file
    import { createTodo } from '@/todo'

    // Raw file content
    import check from '@resources/img/icons/check.svg?raw'

    // Types
    import type { TodoItem } from '@/types'
</script>
```

The `@` alias points to `resources/js` by default. You can [customize the aliases](https://laravel.com/docs/12.x/vite#aliases) in your `vite.config.js` file.

Make sure to always import types using the `import type` syntax to avoid issues.

#### Additional React Configuration

To use React in your Amalgam project:

1. Install the React plugin:
```bash
npm install --save-dev @vitejs/plugin-react
```

2. Add the React plugin **before** the amalgam plugin in your `vite.config.js`:

```js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import amalgam from './vendor/dakin/amalgam/dist/vite-plugin';

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/css/app.css', 'resources/js/app.js'],
      refresh: true,
    }),
    react(), // React plugin MUST come before amalgam
    amalgam(),
  ],
});
```

> **Important:** The React plugin must be configured **before** the amalgam plugin so it can process the `.tsx` virtual modules that Amalgam generates.

#### React vs Alpine Scripts

- **Regular scripts** (`<script editor>`): Processed as vanilla JavaScript
- **React scripts** (`<script editor type="jsx">`): Processed as JSX/TypeScript

React scripts are compiled to separate `.tsx` modules. React detection is based on `type="jsx"`.

## Custom block editors

Import the editor APIs from `amalgam/editor`.

```jsx
<script editor type="jsx">
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody } from '@wordpress/components';
import { registerBlockEdit, ServerPreview } from 'amalgam/editor';

registerBlockEdit('example/banner', (props) => (
  <>
    <ServerPreview {...props} />
    <InspectorControls>
      <PanelBody title="Banner settings">
        <p>Custom editor controls.</p>
      </PanelBody>
    </InspectorControls>
  </>
));
</script>
```

`registerBlockEdit(name, Edit)` installs a `blocks.registerBlockType` filter immediately. It replaces only `settings.edit` for the exact block name; the rest of the block settings and every other block remain unchanged. Calling it again for the same block replaces Amalgam's earlier filter. It returns a cleanup function; an older cleanup cannot remove a newer registration.

`ServerPreview` renders the named block through WordPress's server-side-render hook, forwards `context.postId` as `post_id`, disables interaction with preview links/forms, and sets `aria-busy` while fetching. It keeps the last successful HTML mounted during later requests and errors, displays a non-dismissible error notice, and treats successful empty HTML as an empty preview. The cache is scoped to the block name. `ServerSideRender` is intended by WordPress as a fallback for legacy/server-rendered blocks; new blocks should generally render from client-side data or a dedicated endpoint.

### Automatically injected React imports

For React scripts only, `reactImports` can inject named imports unconditionally.

```js
amalgam({
  reactImports: [
    { from: 'amalgam/editor', named: ['ServerPreview', 'registerBlockEdit'] },
    { from: '@example/editor-tools', named: [{ imported: 'ThemeIcon', local: 'Icon' }] },
  ],
});
```

With that configuration, a Blade script can use `ServerPreview`, `registerBlockEdit`, and `Icon` without local imports. Amalgam parses top-level bindings to avoid duplicate equivalent imports and reports collisions with the Blade file, symbol, and conflicting module. Alias the configured local name or remove the conflicting import/configuration. This injection is unconditional in every recognized React script.

### Build and runtime requirements

- Configure `@vitejs/plugin-react` before `amalgam()` so it transforms extracted `.tsx` modules.
- The package build uses Vite 6 (Node.js 18+); the test suite uses Vitest 4 (Node.js 20+). The generated Vite plugin bundle remains targeted at Node.js 14 syntax.
- React scripts use the WordPress packages `@wordpress/blocks`, `@wordpress/block-editor`, `@wordpress/components`, `@wordpress/compose`, `@wordpress/element`, `@wordpress/hooks`, and `@wordpress/server-side-render`. Your consumer build must resolve these imports to the host WordPress packages. Externalize/map `react`, `react-dom`, and the generated `react/jsx-runtime` or `react/jsx-dev-runtime` to the same React instance used by `@wordpress/element`; do not bundle a separate React renderer. The test fixture verifies the Vite build with these host modules externalized, but this repository does not include a consuming WordPress installation or its Vite resolver.
- Preview requests require the server-side block registration and its attributes to be declared in PHP. The WordPress ServerSideRender hook is documented in current Block Editor package documentation; this package does not claim a minimum WordPress release because the actual package exports available depend on the consuming WordPress build.
- React-script imports are standard Vite module imports, not WordPress globals. The consumer must provide the corresponding module resolution/runtime mapping.

### TypeScript

Amalgam uses TypeScript to provide a terse syntax for props and also to power the IDE features. However, it disables the `strict` mode by default. This means you are not forced to use types. You can write regular JavaScript without getting type errors, but still get autocomplete and type hints in your IDE.
