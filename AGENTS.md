# AGENTS.md

This file contains guidelines and commands for agentic coding agents working in the Amalgam repository.

## Project Overview

Amalgam is a PHP/JavaScript package that provides block scaffolding from Blade templates. It extracts `<script setup>` blocks from Blade files and compiles them with Vite, enabling modern component authoring for Laravel Blade and Alpine.js.

## Build Commands

### JavaScript/TypeScript
```bash
# Build the Vite plugin
npm run build

# Development with file watching
npm run dev
```

### PHP
```bash
# Install dependencies
composer install

# Update autoloader
composer dump-autoload
```

## Testing

This project currently does not have automated tests configured. When implementing tests:

- For PHP: Use PHPUnit with `composer test`
- For JavaScript: Add test script to package.json with `npm test`

## Code Style Guidelines

### PHP Code Style
- Follow PSR-12 coding standard
- Use strict typing for method parameters and return types
- Namespace: `Dakin\Amalgam\`
- Class names: PascalCase (e.g., `AmalgamServiceProvider`)
- Method names: camelCase (e.g., `prepareStringsForCompilationUsing`)
- Always include PHPDoc blocks for public methods

### JavaScript/TypeScript Code Style
- Use ES6+ syntax and modules
- Prefer `const` over `let`, avoid `var`
- Function names: camelCase
- Variable names: camelCase
- Use JSDoc comments for exported functions
- TypeScript interfaces: PascalCase (e.g., `Magics<T>`)

### File Organization
```
src/                    # PHP source code
├── AmalgamServiceProvider.php
js/                     # JavaScript source code
├── vite.js            # Vite plugin
├── amalgam.js         # Core functionality
├── alpine.js          # Alpine.js integration
├── bond.js            # Bond framework integration
types/                 # TypeScript definitions
├── alpine.d.ts
dist/                  # Built assets
```

### Import Conventions
- PHP: Use fully qualified namespace imports at top of file
- JavaScript: Use ES6 import syntax, group external dependencies first
- TypeScript: Use `import type` for type-only imports

### Error Handling
- PHP: Use try-catch blocks for file operations, log warnings with context
- JavaScript: Use try-catch for async operations, provide meaningful error messages
- Always handle file system operations gracefully (files may not exist)

### Naming Conventions
- Components: kebab-case for file names (e.g., `alert.blade.php`)
- Virtual modules: Use `virtual:` prefix
- Configuration options: camelCase (e.g., `viewsPath`, `watchFiles`)

## Development Workflow

### Vite Plugin Development
- The plugin extracts `<script setup>` blocks with `editor` attribute from Blade files
- Virtual module ID: `virtual:amalgam`
- Script requests use `?amalgam` query parameter
- Component names generated from file paths relative to `resources/views`

### Blade Integration
- Script setup blocks use `<script editor>` instead of `<script setup>`
- Components are isolated from outer scope
- Use `{{ $attributes }}` for component root element
- Props accessed via `props.` prefix in templates

### React Support
- React scripts use `<script editor type="react">` attribute
- React scripts are compiled to `.tsx` virtual modules
- Regular scripts remain as `.ts` virtual modules
- React scripts bypasses `mount()` transformation (full user control)
- Requires `@vitejs/plugin-react` to be installed and configured

### File Watching
- Plugin automatically watches `.blade.php` files in `resources/views`
- Changes trigger module invalidation and full reload
- Handles file add/unlink events

## Key Patterns

### Virtual Module Generation
```javascript
// Generate virtual .ts/.tsx modules for blade scripts
const virtualPath = scriptInfo.isReact ? `${cleanPath}.tsx?amalgam` : `${cleanPath}.ts?amalgam`;
imports.push(`import '/${virtualPath}';`);
```

### Script Extraction
```javascript
// Extract script setup content
const scriptSetupRegex = /<script\s[^>]*\beditor\b[^>]*>([\s\S]*?)<\/script>/i;
```

### Component Name Generation
```javascript
// Convert file path to component name
componentName = filePath
  .replace(viewsPath + '/', '')
  .replace(/\.blade\.php$/, "")
  .split('/').join(".");
```

## Security Considerations
- Sanitize file paths to prevent directory traversal
- Validate file extensions (.blade.php only)
- Handle file system errors gracefully
- Never expose sensitive file contents

## Performance Notes
- Use Vite's built-in file watching instead of custom watchers
- Lazy load blade files during build start
- Minimize file system operations
- Use efficient regex patterns for script extraction

## IDE Integration
- TypeScript definitions in `types/` directory
- Alpine.js types for better autocomplete
- Component isolation for scope safety

## Package Configuration
- Name: `dakin/amalgam`
- Type: Laravel package with Vite plugin
- Dependencies: Minimal, focused on core functionality
- Build target: Node.js ES modules