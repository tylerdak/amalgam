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
  function extractScriptSetup(content) {
    const scriptSetupRegex = /<script\s[^>]*\beditor\b[^>]*>([\s\S]*?)<\/script>/i;
    const match = scriptSetupRegex.exec(content);
    return match ? match[1].trim() : null;
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
    modified += "import { mount } from 'amalgam';\n\n";
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
      const virtualScriptPath = `/${cleanPath}.ts?amalgam`;
      const scriptModule = server.moduleGraph.getModuleById(virtualScriptPath);
      if (scriptModule) {
        server.reloadModule(scriptModule);
      }
      server.ws.send({
        type: "full-reload"
      });
    }
  }
  return {
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
          const script = extractScriptSetup(content);
          if (script) {
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
        return resolve(process.cwd(), join("vendor", "dakin", "amalgam", "js", "amalgam.js"));
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
            const script = extractScriptSetup(content);
            if (script) {
              const relativePath = relative(process.cwd(), filePath);
              const cleanPath = normalizePath(relativePath).replace(/\.blade\.php$/, "");
              const virtualPath = `${cleanPath}.ts?amalgam`;
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
          const actualFilename = filename.replace(/\.ts$/, ".blade.php");
          const path = join(process.cwd(), actualFilename);
          const content = readFileSync(path, "utf-8");
          const script = extractScriptSetup(content);
          if (script) {
            const transformedScript = transformMountCalls(script, actualFilename);
            return transformedScript;
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
          const script = extractScriptSetup(content);
          if (script) {
            const importStatement = `import /'${id}.ts?amalgam';`;
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
}
export {
  amalgam as default
};
