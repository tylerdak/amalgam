import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, relative } from 'path';
import { normalizePath } from 'vite';

export default function amalgam(options = {}) {
  const {
    viewsPath = 'resources/views',
    watchFiles = true,
  } = options;

  let server;
  const virtualModuleId = 'virtual:amalgam';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  /**
   * Find all .blade.php files recursively
   */
  function findBladeFiles(dir) {
    if (!existsSync(dir)) {
      return [];
    }

    const files = [];

    function traverse(currentDir) {
      try {
        const items = readdirSync(currentDir, { withFileTypes: true });

        for (const item of items) {
          const fullPath = join(currentDir, item.name);

          if (item.isDirectory()) {
            traverse(fullPath);
          } else if (item.name.endsWith('.blade.php')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`[amalgam] Cannot read directory ${currentDir}:`, error.message);
      }
    }

    traverse(dir);
    return files;
  }


  /**
   * Extract <script setup> content from blade file (only first one)
   */
  function extractScriptSetup(content) {
    const scriptSetupRegex = /<script\s[^>]*\beditor\b[^>]*>([\s\S]*?)<\/script>/i;
    const match = scriptSetupRegex.exec(content);

    return match ? match[1].trim() : null;
  }

  /**
   * Extract script tag with type attribute information
   */
  function extractScriptSetupWithInfo(content) {
    const scriptSetupRegex = /<script\s([^>]*\beditor\b[^>]*)>([\s\S]*?)<\/script>/i;
    const match = scriptSetupRegex.exec(content);

    if (!match) return null;

    const attributes = match[1];
    const scriptContent = match[2].trim();

    // Extract type attribute
    const typeMatch = attributes.match(/type\s*=\s*["']([^"']+)["']/i);
    const isReact = typeMatch && typeMatch[1] === 'jsx';

    return {
      content: scriptContent,
      isReact: isReact
    };
  }

  /**
   * Check if script is React type
   */
  function isReactScript(scriptInfo) {
    return scriptInfo && scriptInfo.isReact;
  }

  /**
   * Get virtual module path based on script type
   */
  function getVirtualModulePath(cleanPath, isReact) {
    return isReact ? `${cleanPath}.tsx?amalgam` : `${cleanPath}.ts?amalgam`;
  }

  /**
   * Check if any blade files have React scripts
   */
  function hasReactScripts(viewsPath) {
    const bladeFiles = findBladeFiles(resolve(viewsPath));

    for (const filePath of bladeFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const scriptInfo = extractScriptSetupWithInfo(content);
        if (isReactScript(scriptInfo)) {
          return true;
        }
      } catch (error) {
        // Ignore file read errors during check
      }
    }
    return false;
  }

  /**
   * Generate component name from file path
   */
  function generateComponentName(viewsPath, filePath) {
    return filePath
      .slice(1)
      .replace(viewsPath + '/', '')
      .replace(/\.blade\.php$/, "")
      .split('/').join(".");
  }

  function extractPropNames(code) {
    const typeMatch = code.match(/props\s*:\s*{([^}]*)}/s);
    if (!typeMatch) return [];

    const propsMatch = typeMatch[1].matchAll(/["']?([a-zA-Z_$][\w$]*)["']?\s*\??:/g);
    return [...propsMatch].map(m => m[1]);
  }

  function transformMountCalls(code, filename) {
    const componentName = generateComponentName(viewsPath, filename);
    const props = JSON.stringify(extractPropNames(code))

    let modified = ''

    modified += "import { mount, AdditionalEditContent } from 'amalgam';\n\n"
    modified += code.replace('mount(', `mount("${componentName}", ${props}, `)

    return modified
  }

  /**
   * Parse blade script request
   */
  function parseBladeRequest(id) {
    const [filename] = id.split('?', 2);
    return { filename };
  }

  /**
   * Check if this is a blade script request
   */
  function isBladeScriptRequest(id) {
    return id.includes('?amalgam');
  }


  /**
   * Handle file changes for blade files
   */
  function handleFileChange(filePath) {
    if (server) {
      // Invalidate the main virtual module
      const virtualModule = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
      if (virtualModule) {
        server.reloadModule(virtualModule);
      }

      // Find and invalidate the corresponding virtual .ts/.tsx?amalgam modules
      const relativePath = relative(process.cwd(), filePath);
      const cleanPath = normalizePath(relativePath.replace(/\.blade\.php$/, ''));

      // Try both .ts and .tsx extensions
      const virtualScriptPaths = [
        `/${cleanPath}.ts?amalgam`,
        `/${cleanPath}.tsx?amalgam`
      ];

      for (const virtualScriptPath of virtualScriptPaths) {
        const scriptModule = server.moduleGraph.getModuleById(virtualScriptPath);
        if (scriptModule) {
          server.reloadModule(scriptModule);
          break;
        }
      }

      // Force a full reload as fallback
      server.ws.send({
        type: 'full-reload'
      });
    }
  }

    // Create the main amalgam plugin
  const amalgamPlugin = {
    name: 'vite-blade-script-setup',

    configureServer(devServer) {
      server = devServer;

      // Setup file watching using Vite's internal watcher during dev
      if (watchFiles) {
        const bladeFiles = findBladeFiles(resolve(viewsPath));

        for (const filePath of bladeFiles) {
          // Add each blade file to Vite's watcher
          server.watcher.add(filePath);
        }

        // Listen to file changes
        server.watcher.on('change', (filePath) => {
          if (filePath.endsWith('.blade.php')) {
            handleFileChange(filePath)
          }
        });
        server.watcher.on('add', (filePath) => {
          if (filePath.endsWith('.blade.php')) {
            handleFileChange(filePath);
          }
        });
        server.watcher.on('unlink', (filePath) => {
          if (filePath.endsWith('.blade.php')) {
            handleFileChange(filePath);
          }
        });
      }
    },

    buildStart() {
      // During build, automatically discover and add blade files to the build
      const bladeFiles = findBladeFiles(resolve(viewsPath));

      for (const filePath of bladeFiles) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const scriptInfo = extractScriptSetupWithInfo(content);

          if (scriptInfo) {
            this.addWatchFile(filePath);
          }
        } catch (error) {
          console.warn(`[amalgam] Error processing ${filePath}:`, error.message);
        }
      }
    },

    resolveId(id) {
      // Handle the main virtual module
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }

      // Handle amalgam module alias
      if (id === 'amalgam') {
        return resolve(process.cwd(), join('vendor', 'dakin', 'amalgam', 'js', 'amalgam.jsx'));
      }

      // Handle blade script requests similar to Vue's approach
      if (isBladeScriptRequest(id)) {
        return id; // Return as-is, we'll handle it in load
      }
      return null;
    },

    load(id) {
      // Handle the main virtual module that imports all blade scripts
      if (id === resolvedVirtualModuleId) {
        const bladeFiles = findBladeFiles(resolve(viewsPath));
        const imports = [];

        for (const filePath of bladeFiles) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            const scriptInfo = extractScriptSetupWithInfo(content);

if (scriptInfo) {
              // Create a .ts or .tsx virtual file so Vite handles TypeScript transformation
              // Use relative path for virtual module ID, normalize to forward slashes for URLs
              const relativePath = relative(process.cwd(), filePath);
              const cleanPath = normalizePath(relativePath).replace(/\.blade\.php$/, '');
              const virtualPath = getVirtualModulePath(cleanPath, scriptInfo.isReact);

              if (scriptInfo.isReact) {
                console.log(`[amalgam] React script found in ${filePath}`);
              }

              imports.push(`import '/${virtualPath}';`);
            }
          } catch (error) {
            console.warn(`[amalgam] Error processing ${filePath}:`, error.message);
          }
        }

        const moduleContent = imports.length > 0
          ? imports.join('\n')
          : '// No blade script setup blocks found';

        return moduleContent;
      }

      // Handle blade script requests
      if (isBladeScriptRequest(id)) {
        const { filename } = parseBladeRequest(id);

        try {
          // Remove the .ts/.tsx extension and add back .blade.php to get the actual file
          const actualFilename = filename.replace(/\.(ts|tsx)$/, ".blade.php");
          const path = join(process.cwd(), actualFilename)

          const content = readFileSync(path, 'utf-8');
          const scriptInfo = extractScriptSetupWithInfo(content);

          if (scriptInfo) {
            // Only transform mount() calls for non-React scripts
            if (scriptInfo.isReact) {
              // Add helpful comment for React scripts
              const commentedContent = `// React component from ${actualFilename}\n` + scriptInfo.content;
              let modified = '';

              modified += "import { mount, AdditionalEditContent } from 'amalgam';\n\n"
              modified += commentedContent

              return modified
            } else {
              const transformedScript = transformMountCalls(scriptInfo.content, actualFilename);
              return transformedScript;
            }
          } else {
            console.warn(`[amalgam] No script setup found in ${actualFilename}`);
            return 'export {};'; // Empty module
          }
        } catch (error) {
          console.error(`[amalgam] Error loading blade script ${filename}:`, error.message);
          return 'export {};'; // Empty module fallback
        }
      }

      return null;
    },

    transform(_, id) {
      // Transform main blade files to import their script setup content
      if (id.endsWith('.blade.php') && !isBladeScriptRequest(id)) {
        try {
          const content = readFileSync(id, 'utf-8');
          const scriptInfo = extractScriptSetupWithInfo(content);

          if (scriptInfo) {
            // Determine the correct extension based on script type
            const extension = scriptInfo.isReact ? 'tsx' : 'ts';
            const importStatement = `import '${id}.${extension}?amalgam';`;

            // Return the import as the module content
            return {
              code: importStatement,
              map: null
            };
          }
        } catch (error) {
          console.warn(`[amalgam] Error transforming blade file ${id}:`, error.message);
        }
      }

      return null;
    },
  };

  // Check if React support is needed and inform user
  const hasReact = hasReactScripts(viewsPath);
  if (hasReact) {
    console.log('[amalgam] React scripts detected. Make sure to configure @vitejs/plugin-react BEFORE amalgam in your vite.config.js');
  }

  return amalgamPlugin;
}


