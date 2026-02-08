import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, relative, join } from "path";
import { normalizePath } from "vite";
function amalgam(options = {}) {
  const {
    viewsPath = "resources/views",
    watchFiles = true
  } = options;
  let server;
  const virtualModuleId = "virtual:amalgam";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
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
  function generateComponentName(viewsPath2, filePath) {
    return filePath.slice(1).replace(viewsPath2 + "/", "").replace(/\.blade\.php$/, "").split("/").join(".");
  }
  function extractPropNames(code) {
    const typeMatch = code.match(/props\s*:\s*{([^}]*)}/s);
    if (!typeMatch) return [];
    const propsMatch = typeMatch[1].matchAll(/["']?([a-zA-Z_$][\w$]*)["']?\s*\??:/g);
    return [...propsMatch].map((m) => m[1]);
  }
  function transformMountCalls(code, filename) {
    const componentName = generateComponentName(viewsPath, filename);
    const props = JSON.stringify(extractPropNames(code));
    let modified = "";
    modified += "import { mount, AdditionalEditContent } from 'amalgam';\n\n";
    modified += code.replace("mount(", `mount("${componentName}", ${props}, `);
    return modified;
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
      if (id === "amalgam") {
        return resolve(process.cwd(), join("vendor", "dakin", "amalgam", "js", "amalgam.jsx"));
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
              const commentedContent = `// React component from ${actualFilename}
` + scriptInfo.content;
              let modified = "";
              modified += "import { mount, AdditionalEditContent } from 'amalgam';\n\n";
              modified += commentedContent;
              return modified;
            } else {
              const transformedScript = transformMountCalls(scriptInfo.content, actualFilename);
              return transformedScript;
            }
          } else {
            console.warn(`[amalgam] No script setup found in ${actualFilename}`);
            return "export {};";
          }
        } catch (error) {
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
