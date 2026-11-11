import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, relative, join } from "path";
import { fileURLToPath } from "node:url";
import { normalizePath } from "vite";
function amalgam(options = {}) {
  const {
    viewsPath = "resources/views",
    watchFiles = true,
    reactImports = []
  } = options;
  const normalizedReactImports = normalizeReactImports(reactImports);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let server;
  const virtualModuleId = "virtual:amalgam";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  function normalizeReactImports(imports) {
    if (!Array.isArray(imports)) {
      throw new TypeError("[amalgam] reactImports must be an array of import definitions.");
    }
    return imports.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`[amalgam] reactImports[${index}] must be an object.`);
      }
      if (typeof entry.from !== "string" || entry.from.trim() === "") {
        throw new TypeError(`[amalgam] reactImports[${index}].from must be a non-empty module specifier.`);
      }
      if (!Array.isArray(entry.named)) {
        throw new TypeError(`[amalgam] reactImports[${index}].named must be an array.`);
      }
      const named = entry.named.map((item, itemIndex) => {
        const imported = typeof item === "string" ? item : item == null ? void 0 : item.imported;
        const local = typeof item === "string" ? item : (item == null ? void 0 : item.local) ?? imported;
        if (typeof imported !== "string" || !/^[A-Za-z_$][\w$]*$/.test(imported)) {
          throw new TypeError(`[amalgam] reactImports[${index}].named[${itemIndex}] has an invalid imported name.`);
        }
        if (typeof local !== "string" || !/^[A-Za-z_$][\w$]*$/.test(local)) {
          throw new TypeError(`[amalgam] reactImports[${index}].named[${itemIndex}] has an invalid local name.`);
        }
        return { imported, local };
      });
      return { from: entry.from, named };
    });
  }
  function injectReactImports(code) {
    const requests = normalizedReactImports;
    const injected = /* @__PURE__ */ new Map();
    for (const request of requests) {
      for (const { imported, local } of request.named) {
        if (!injected.has(request.from)) injected.set(request.from, []);
        injected.get(request.from).push(imported === local ? imported : `${imported} as ${local}`);
      }
    }
    const statements = [...injected].map(([from, names]) => `import { ${names.join(", ")} } from ${JSON.stringify(from)};`);
    return statements.length ? `${statements.join("\n")}

${code}` : code;
  }
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
          } else if (item.name.endsWith(".blade.php")) {
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
  function extractScriptSetupWithInfo(content) {
    const scriptSetupRegex = /<script\s([^>]*\beditor\b[^>]*)>([\s\S]*?)<\/script>/i;
    const match = scriptSetupRegex.exec(content);
    if (!match) return null;
    const attributes = match[1];
    const scriptContent = match[2].trim();
    const typeMatch = attributes.match(/type\s*=\s*["']([^"']+)["']/i);
    const isReact = typeMatch && typeMatch[1] === "jsx";
    return {
      content: scriptContent,
      isReact
    };
  }
  function isReactScript(scriptInfo) {
    return scriptInfo && scriptInfo.isReact;
  }
  function getVirtualModulePath(cleanPath, isReact) {
    return isReact ? `${cleanPath}.tsx?amalgam` : `${cleanPath}.ts?amalgam`;
  }
  function hasReactScripts(viewsPath2) {
    const bladeFiles = findBladeFiles(resolve(viewsPath2));
    for (const filePath of bladeFiles) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const scriptInfo = extractScriptSetupWithInfo(content);
        if (isReactScript(scriptInfo)) {
          return true;
        }
      } catch (error) {
      }
    }
    return false;
  }
  function parseBladeRequest(id) {
    const [filename] = id.split("?", 2);
    return { filename };
  }
  function isBladeScriptRequest(id) {
    return id.includes("?amalgam");
  }
  function handleFileChange(filePath) {
    if (server) {
      const virtualModule = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
      if (virtualModule) {
        server.reloadModule(virtualModule);
      }
      const relativePath = relative(process.cwd(), filePath);
      const cleanPath = normalizePath(relativePath.replace(/\.blade\.php$/, ""));
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
      server.ws.send({
        type: "full-reload"
      });
    }
  }
  const amalgamPlugin = {
    name: "vite-blade-script-setup",
    configureServer(devServer) {
      server = devServer;
      if (watchFiles) {
        const bladeFiles = findBladeFiles(resolve(viewsPath));
        for (const filePath of bladeFiles) {
          server.watcher.add(filePath);
        }
        server.watcher.on("change", (filePath) => {
          if (filePath.endsWith(".blade.php")) {
            handleFileChange(filePath);
          }
        });
        server.watcher.on("add", (filePath) => {
          if (filePath.endsWith(".blade.php")) {
            handleFileChange(filePath);
          }
        });
        server.watcher.on("unlink", (filePath) => {
          if (filePath.endsWith(".blade.php")) {
            handleFileChange(filePath);
          }
        });
      }
    },
    buildStart() {
      const bladeFiles = findBladeFiles(resolve(viewsPath));
      for (const filePath of bladeFiles) {
        try {
          const content = readFileSync(filePath, "utf-8");
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
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      if (id === "amalgam" || id === "amalgam/editor") {
        return resolve(packageRoot, "js", "amalgam.jsx");
      }
      if (isBladeScriptRequest(id)) {
        return id;
      }
      return null;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        const bladeFiles = findBladeFiles(resolve(viewsPath));
        const imports = [];
        for (const filePath of bladeFiles) {
          try {
            const content = readFileSync(filePath, "utf-8");
            const scriptInfo = extractScriptSetupWithInfo(content);
            if (scriptInfo) {
              const relativePath = relative(process.cwd(), filePath);
              const cleanPath = normalizePath(relativePath).replace(/\.blade\.php$/, "");
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
        const moduleContent = imports.length > 0 ? imports.join("\n") : "// No blade script setup blocks found";
        return moduleContent;
      }
      if (isBladeScriptRequest(id)) {
        const { filename } = parseBladeRequest(id);
        try {
          const actualFilename = filename.replace(/\.(ts|tsx)$/, ".blade.php");
          const path = join(process.cwd(), actualFilename);
          const content = readFileSync(path, "utf-8");
          const scriptInfo = extractScriptSetupWithInfo(content);
          if (scriptInfo) {
            if (scriptInfo.isReact) {
              return injectReactImports(scriptInfo.content);
            }
            return scriptInfo.content;
          } else {
            console.warn(`[amalgam] No script setup found in ${actualFilename}`);
            return "export {};";
          }
        } catch (error) {
          if (error.message.startsWith("[amalgam]")) {
            throw error;
          }
          console.error(`[amalgam] Error loading blade script ${filename}:`, error.message);
          return "export {};";
        }
      }
      return null;
    },
    transform(_, id) {
      if (id.endsWith(".blade.php") && !isBladeScriptRequest(id)) {
        try {
          const content = readFileSync(id, "utf-8");
          const scriptInfo = extractScriptSetupWithInfo(content);
          if (scriptInfo) {
            const extension = scriptInfo.isReact ? "tsx" : "ts";
            const importStatement = `import '${id}.${extension}?amalgam';`;
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
    }
  };
  const hasReact = hasReactScripts(viewsPath);
  if (hasReact) {
    console.log("[amalgam] React scripts detected. Make sure to configure @vitejs/plugin-react BEFORE amalgam in your vite.config.js");
  }
  return amalgamPlugin;
}
export {
  amalgam as default
};
