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
<script editor>
console.log('My vanilla JS')
</script>

<!-- A more complicated example using React -->
<script editor type="jsx">
import { PanelBody } from '@wordpress/components';
import { InspectorControls } from '@wordpress/block-editor';

document.addEventListener('DOMContentLoaded', function () {
  wp.blocks.getBlockType('my/block').edit = function ({attributes, setAttributes}) {
    return (<AdditionalEditContent blockName="my/block">
      <InspectorControls>
        <PanelBody title="Custom Panel">
          <p>This sidebar panel is being rendered based on the content within a blade template!</p>
        </PanelBody>
      </InspectorControls>
    </AdditionalEditContent>)
  }
})
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
- **React scripts** (`<script editor type="react">`): Processed as JSX/TypeScript

React scripts are compiled to separate `.tsx` modules. You have full control over component registration and WordPress integration.

### TypeScript

Amalgam uses TypeScript to provide a terse syntax for props and also to power the IDE features. However, it disables the `strict` mode by default. This means you are not forced to use types. You can write regular JavaScript without getting type errors, but still get autocomplete and type hints in your IDE.

Options for both enabling `strict` mode and fully opting out of TypeScript will be available in the future.
