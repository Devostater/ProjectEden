import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const templateDir = fileURLToPath(new URL('./templates/unreal-plugin/', import.meta.url));
const reserved = new Set('core coreuobject engine editor unrealed slate slatecore projects launch inputcore rendercore renderer rhi umg niagara pcg game plugin test tests con prn aux nul'.split(' '));

export function pluginName(display: string) {
  const name = (display.match(/[a-z0-9]+/gi) || [])
    .map((part) => part[0].toUpperCase() + part.slice(1)).join('').replace(/^\d+/, '').slice(0, 24);
  if (name.length < 3 || reserved.has(name.toLowerCase()) || /^(com|lpt)[1-9]$/i.test(name)) {
    throw new Error(`"${display}" cannot be used as a plugin name. Use letters and digits, starting with a letter, for example "Sky Tools".`);
  }
  return name;
}

export function publisherName(raw: unknown) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 2 || name.length > 80 || /[\x00-\x1f\u0085\u2028\u2029]/.test(name)) {
    throw new Error('Give the publisher name. It goes into the copyright line of every source file, which Fab requires.');
  }
  return name;
}

export function writeUnrealPlugin(dir: string, { name, display, purpose, publisher, date }: {
  name: string; display: string; purpose: string; publisher: string; date: string;
}) {
  if (path.resolve(dir).length > 100) {
    throw new Error('The project folder path is too long for Unreal. Use a shorter name or a shorter AZI folder path (100 characters at most).');
  }
  purpose ||= 'Describe in one or two sentences what this plugin does.';
  const json = (value: string) => JSON.stringify(value).slice(1, -1);
  const values: Record<string, string> = {
    NAME: name, NAME_UPPER: name.toUpperCase(),
    DISPLAY: display, DISPLAY_JSON: json(display), PURPOSE: purpose, PURPOSE_JSON: json(purpose),
    PUBLISHER: publisher, PUBLISHER_JSON: json(publisher), YEAR: date.slice(0, 4), DATE: date,
  };
  const fill = (value: string) => value.replace(/__([A-Z_]+?)__/g, (token, key) => values[key] ?? token);
  const copy = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const filename = entry.name === '_gitignore' || entry.name === '_gitattributes' ? '.' + entry.name.slice(1) : fill(entry.name);
      const target = path.join(to, filename);
      if (entry.isDirectory()) {
        copy(source, target);
        continue;
      }
      try {
        if (entry.name.endsWith('.png')) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        else fs.writeFileSync(target, fill(fs.readFileSync(source, 'utf8')).replace(/\r\n?/g, '\n'), { flag: 'wx' });
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
  };
  copy(templateDir, dir);
}

export function unrealPluginSignUp(name: string, display: string) {
  return {
    settings: {
      ai: 'codex', unreal: true, proof: 'powershell -NoProfile -ExecutionPolicy Bypass -File autopilot\\proof.ps1',
      // The zip is made from the plugin's folder only, so only that folder counts for "package older than source".
      proofMinutes: 120, packageFiles: 'dist\\*.zip', packageFrom: `Plugins\\${name}`,
    },
    codebase: {
      // Read after "You are improving …" in the AI's instructions, like the other codebases' descriptions.
      about: `"${display}", an Unreal Engine 5.8 plugin. The product is the plugin in Plugins/${name}; the project around it is only a host for building and testing. Read AGENTS.md first. You cannot run Unreal: write the code and an automation test whose name starts with "${name}.", and leave the build to the hub, which runs the proof (autopilot/proof.ps1) after you finish.`,
      protect: ['autopilot/run.ps1', 'autopilot/proof.ps1', 'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache'],
      restartHint: 'build the plugin again (the proof does this, or open the project in Unreal)',
      liveDirs: [],
    },
    runner: (dir: string) => ({
      id: path.basename(dir).toLowerCase(), name: `${display} autopilot`, cwd: path.resolve(dir),
      command: 'powershell -NoProfile -ExecutionPolicy Bypass -File autopilot\\run.ps1',
      tasksFile: 'autopilot\\TASKS.md', logFile: 'autopilot\\runs\\autopilot.txt', lockFile: 'autopilot\\runs\\runner.lock',
    }),
  };
}
