#!/usr/bin/env node
// Extract every complete ESP-IDF program from the course content into
// tools/idf-check/build/<id>/ as a minimal ESP-IDF project.
//
//   node tools/idf-check/extract.mjs            extract everything, print a summary
//   node tools/idf-check/extract.mjs --list     print the manifest table only (still extracts)
//   node tools/idf-check/extract.mjs --json     print build/manifest.json to stdout
//
// See README.md in this directory for the rules. No dependencies beyond node >= 18.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CONTENT = path.join(REPO, 'js', 'content');
const OUT = path.join(HERE, 'build');
const OVERRIDES = path.join(HERE, 'overrides');
const IDF_PATH = process.env.IDF_PATH || '/home/user/espressif/esp-idf';

const C_LANGS = new Set(['c', 'cpp', 'c++', 'h', '']);
const RE_APP_MAIN = /\bvoid\s+app_main\s*\(/;
const RE_INCLUDE = /^[ \t]*#[ \t]*include[ \t]*[<"]([^>"]+)[>"]/gm;
// A header that only ESP-IDF provides (as opposed to the C library).
const RE_IDF_HEADER = /^(freertos\/|driver\/|esp_|esp32|nvs|soc\/|hal\/|rom\/|sdkconfig\.h|lwip\/|mbedtls\/|mqtt_|host\/|nimble\/|services\/|bootloader_|spi_flash|wear_|sdmmc|unity|ulp|led_strip|cJSON|psa\/)/;

// ---------------------------------------------------------------------------
// 1. Collect every code listing of every lesson and lab, in document order.
// ---------------------------------------------------------------------------
function collectListings(unit) {
  const out = [];
  const add = (l) => { l.index = out.length; out.push(l); };
  const walk = (node, p) => {
    if (typeof node === 'string') {
      const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
      let m;
      while ((m = re.exec(node))) {
        add({ kind: 'fence', lang: m[1].toLowerCase(), status: '', caption: '', path: p, code: m[2].replace(/\n$/, '') });
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((c, i) => walk(c, `${p}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.code === 'string') {
      add({
        kind: node.t || (p.includes('.steps[') ? 'step' : 'question'),
        lang: (node.lang || '').toLowerCase(), status: node.status || '',
        caption: node.caption || node.title || '', path: p, code: node.code,
      });
    }
    for (const k of Object.keys(node)) if (k !== 'code') walk(node[k], `${p}.${k}`);
  };
  walk(unit, '');
  return out;
}

// ---------------------------------------------------------------------------
// 2. Classify listings: program, companion file, or neither.
// ---------------------------------------------------------------------------
const includesOf = (code) => [...code.matchAll(RE_INCLUDE)].map((m) => m[1]);
const hasIdfInclude = (code) => includesOf(code).some((h) => RE_IDF_HEADER.test(h));
const isC = (l) => C_LANGS.has(l.lang) && !/^\s*(idf_component_register|cmake_minimum_required|menu\s+"|dependencies:|#\s*\S*CMakeLists)/m.test(l.code);

// File name mentioned at the start of a caption: "main/main.c, version 1" -> main.c
function captionFile(caption) {
  const m = /^\s*`?((?:[\w.-]+\/)*[\w.-]+\.(?:c|h|cpp|hpp|txt|yml|csv|projbuild|defaults))\b/.exec(caption || '');
  if (m) return m[1];
  const k = /((?:[\w.-]+\/)*(?:Kconfig(?:\.projbuild)?|sdkconfig\.defaults|idf_component\.yml|partitions\.csv))/.exec(caption || '');
  return k ? k[1] : null;
}

// Split a cmake listing that shows both files (top-level and main/) into its parts.
function splitCmake(code) {
  const lines = code.split('\n');
  const reg = lines.findIndex((l) => /^\s*idf_component_register\s*\(/.test(l));
  const proj = lines.findIndex((l) => /^\s*project\s*\(/.test(l));
  if (reg < 0) return { top: proj >= 0 ? code : null, main: null };
  if (proj < 0) return { top: null, main: code };
  // both: cut at the last comment/blank run before idf_component_register (or before project())
  if (proj < reg) {
    let cut = reg; while (cut > proj + 1 && /^\s*(#.*)?$/.test(lines[cut - 1])) cut--;
    return { top: lines.slice(0, cut).join('\n').trimEnd(), main: lines.slice(cut).join('\n') };
  }
  let depth = 0, end = reg;
  for (let i = reg; i < lines.length; i++) {
    depth += (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
    if (depth <= 0) { end = i; break; }
  }
  return { top: lines.slice(end + 1).join('\n').trim(), main: lines.slice(0, end + 1).join('\n') };
}

function companionOf(l) {
  const file = captionFile(l.caption);
  const base = file ? path.basename(file) : '';
  if (/idf_component_register\s*\(/.test(l.code) || /include\(\$ENV\{IDF_PATH\}/.test(l.code)) return { type: 'cmake', ...splitCmake(l.code) };
  if (/^Kconfig/.test(base) || (l.lang !== 'c' && /^\s*menu\s+"/.test(l.code) && /\bconfig\s+\w+/.test(l.code))) return { type: 'kconfig', name: base || 'Kconfig.projbuild' };
  if (base === 'idf_component.yml' || (!isCish(l) && /^dependencies:\s*$/m.test(l.code))) return { type: 'manifest', name: 'idf_component.yml' };
  if (base === 'sdkconfig.defaults' || (!isCish(l) && /^(CONFIG_\w+=.*\n?)+$/.test(l.code.trim() + '\n') && l.code.trim())) return { type: 'sdkconfig', name: 'sdkconfig.defaults' };
  if (base === 'partitions.csv') return { type: 'partitions', name: base };
  if (/\.(c|h|cpp|hpp)$/.test(base) && !RE_APP_MAIN.test(l.code)) return { type: 'source', name: base, hostMain: /\bint\s+main\s*\(/.test(l.code) };
  return null;
}
function isCish(l) { return l.lang === 'c' || l.lang === 'cpp'; }

// ---------------------------------------------------------------------------
// 3. Header -> component index (only used when the course gives no main/CMakeLists.txt)
// ---------------------------------------------------------------------------
let headerIndex = null;
function buildHeaderIndex() {
  headerIndex = new Map();
  const root = path.join(IDF_PATH, 'components');
  if (!fs.existsSync(root)) return;
  const skipDir = /^(test_apps|test|tests|host_test|linux|examples|docs|\.git|esp32[a-z]\w*|esp8684|esp8266)$/;
  for (const comp of fs.readdirSync(root).sort()) {
    const cdir = path.join(root, comp);
    if (!fs.statSync(cdir).isDirectory()) continue;
    const stack = [cdir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!skipDir.test(e.name)) stack.push(path.join(d, e.name)); continue; }
        if (!e.name.endsWith('.h')) continue;
        const rel = path.relative(cdir, path.join(d, e.name)).split(path.sep);
        // register every suffix of the path that could be written in an #include
        for (let i = 0; i < rel.length; i++) {
          const key = rel.slice(i).join('/');
          const isPublic = rel.slice(0, i).some((s) => s === 'include' || s === 'register') || i === 0;
          if (!isPublic) continue;
          const prev = headerIndex.get(key);
          const depth = i + (rel.slice(0, i).includes('private_include') || rel.slice(0, i).includes('priv_include') ? 100 : 0);
          if (!prev || depth < prev.depth) headerIndex.set(key, { comp, depth });
        }
      }
    }
  }
}
// Components every component gets without asking (COMMON_REQUIRES in v6.1), plus C library headers.
const COMMON = new Set(['cxx', 'esp_libc', 'newlib', 'freertos', 'esp_hw_support', 'heap', 'log', 'soc', 'hal', 'esp_rom', 'esp_common', 'esp_system', 'xtensa', 'riscv', 'esp_hal_gpio']);
function inferRequires(sources) {
  if (!headerIndex) buildHeaderIndex();
  const req = new Set(); const unknown = [];
  for (const code of sources) for (const h of includesOf(code)) {
    const hit = headerIndex.get(h);
    if (!hit) { if (RE_IDF_HEADER.test(h)) unknown.push(h); continue; }
    if (!COMMON.has(hit.comp)) req.add(hit.comp);
  }
  return { requires: [...req].sort(), unknown };
}

// ---------------------------------------------------------------------------
// 4. Build the projects
// ---------------------------------------------------------------------------
const sections = [];
for (const f of fs.readdirSync(CONTENT).filter((f) => f.endsWith('.js')).sort()) {
  const mod = (await import(pathToFileURL(path.join(CONTENT, f)).href)).default;
  if (mod && mod.id) sections.push(mod);
}

const manifest = [];
const seenIds = new Set();
const byHash = new Map();
const written = new Set();

function writeIfChanged(file, text) {
  written.add(file);
  if (!text.endsWith('\n')) text += '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

for (const sec of sections) {
  for (const unitKind of ['lessons', 'labs']) {
    for (const unit of sec[unitKind] || []) {
      const listings = collectListings(unit);
      listings.forEach((l) => { l.comp = companionOf(l); });
      for (const l of listings) {
        if (l.comp || !isC(l) || !RE_APP_MAIN.test(l.code)) continue;
        const id = `${unit.id}-${l.index}`;
        if (seenIds.has(id)) throw new Error(`duplicate id ${id}`);
        seenIds.add(id);
        const entry = {
          id, section: sec.id, unit: unit.id, unitKind: unitKind === 'lessons' ? 'lesson' : 'lab',
          index: l.index, path: l.path, blockKind: l.kind, status: l.status || null,
          caption: l.caption, lines: l.code.split('\n').length,
        };
        manifest.push(entry);

        // 4a. the program text; a listing without #include continues the listings before it
        let code = l.code; const joined = [];
        if (includesOf(code).length === 0) {
          const parts = [];
          for (let i = l.index - 1; i >= 0; i--) {
            const p = listings[i];
            if (p.kind !== l.kind || p.comp || !isC(p) || RE_APP_MAIN.test(p.code) || p.status === 'host-tested') break;
            parts.unshift(p);
            if (includesOf(p.code).length) break;
          }
          if (parts.length && includesOf(parts[0].code).length) {
            code = [...parts.map((p) => p.code), l.code].join('\n\n');
            joined.push(...parts.map((p) => p.index));
          }
        }
        if (joined.length) entry.joinedFrom = joined;
        if (!hasIdfInclude(code)) {
          entry.skip = includesOf(code).length ? 'no ESP-IDF #include (not an ESP-IDF program)' : 'fragment: app_main without #include lines';
          continue;
        }
        const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 12);
        entry.sha1 = hash;
        if (byHash.has(hash)) { entry.skip = `identical to ${byHash.get(hash)}`; entry.sameAs = byHash.get(hash); continue; }
        byHash.set(hash, id);

        // 4b. companions from the same lesson/lab: the nearest one before the program, else the nearest after
        const nearest = (pred) => {
          const before = listings.filter((x) => x.index < l.index && x.comp && pred(x.comp)).pop();
          return before || listings.find((x) => x.index > l.index && x.comp && pred(x.comp)) || null;
        };
        const dir = path.join(OUT, id);
        const files = {};
        const cmMain = nearest((c) => c.type === 'cmake' && c.main);
        const cmTop = nearest((c) => c.type === 'cmake' && c.top);
        const sources = listings.filter((x) => x.comp && x.comp.type === 'source');
        const srcNames = new Set(sources.map((s) => s.comp.name));

        // file name of the program itself
        let mainName = captionFile(l.caption);
        mainName = mainName && /\.(c|cpp)$/.test(mainName) ? path.basename(mainName) : null;
        const listed = cmMain ? [...cmMain.comp.main.matchAll(/"([^"]+\.(?:c|cpp))"/g)].map((m) => m[1]) : [];
        if (!mainName) mainName = listed.map((s) => path.basename(s)).find((s) => !srcNames.has(s)) || (l.lang === 'cpp' ? 'main.cpp' : 'main.c');
        files[`main/${mainName}`] = code;
        for (const s of sources) files[`main/${s.comp.name}`] = s.code;

        if (cmMain) {
          files['main/CMakeLists.txt'] = cmMain.comp.main;
          entry.cmakeMain = `course (${unit.id}-${cmMain.index})`;
        } else {
          const extra = sources.filter((s) => /\.(c|cpp)$/.test(s.comp.name) && !s.comp.hostMain);
          const { requires, unknown } = inferRequires([code, ...sources.filter((s) => !s.comp.hostMain).map((s) => s.code)]);
          const srcs = [mainName, ...extra.map((s) => s.comp.name)].map((s) => `"${s}"`).join(' ');
          files['main/CMakeLists.txt'] =
            `# generated by tools/idf-check/extract.mjs: the course gives no main/CMakeLists.txt here.\n` +
            `# PRIV_REQUIRES was inferred from the #include lines.\n` +
            `idf_component_register(SRCS ${srcs}\n                       INCLUDE_DIRS "."` +
            (requires.length ? `\n                       PRIV_REQUIRES ${requires.join(' ')})` : ')');
          entry.cmakeMain = 'generated';
          entry.inferredRequires = requires;
          if (unknown.length) entry.unknownHeaders = unknown;
        }
        if (cmTop) {
          files['CMakeLists.txt'] = cmTop.comp.top;
          entry.cmakeTop = `course (${unit.id}-${cmTop.index})`;
        } else {
          files['CMakeLists.txt'] =
            `# generated by tools/idf-check/extract.mjs (same shape as examples/get-started/hello_world in v6.1)\n` +
            `cmake_minimum_required(VERSION 3.22)\n\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\n` +
            `idf_build_set_property(MINIMAL_BUILD ON)\nproject(idf_check)`;
          entry.cmakeTop = 'generated (MINIMAL_BUILD ON)';
        }
        const extras = [];
        for (const [type, dest] of [['kconfig', 'main/'], ['manifest', 'main/'], ['sdkconfig', ''], ['partitions', '']]) {
          const c = nearest((x) => x.type === type);
          if (c) { files[dest + c.comp.name] = c.code; extras.push(`${dest}${c.comp.name} (${unit.id}-${c.index})`); }
        }
        if (extras.length) entry.extraFiles = extras;
        if (sources.length) entry.sourceFiles = sources.map((s) => `main/${s.comp.name} (${unit.id}-${s.index})`);

        // 4c. reviewer-supplied overrides (for example an sdkconfig.defaults the prose asks for)
        const ov = path.join(OVERRIDES, id);
        if (fs.existsSync(ov)) {
          const stack = [ov];
          while (stack.length) {
            const d = stack.pop();
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
              const full = path.join(d, e.name);
              if (e.isDirectory()) stack.push(full);
              else files[path.relative(ov, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
            }
          }
          entry.overrides = true;
        }
        for (const [rel, text] of Object.entries(files)) writeIfChanged(path.join(dir, rel), text);
        entry.files = Object.keys(files).sort();
        entry.dir = path.relative(HERE, dir);
        // remove stale extracted files (never the build/ output directory or logs)
        for (const sub of ['', 'main']) {
          const d = path.join(dir, sub);
          for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
            const full = path.join(d, e.name);
            if (e.isFile() && !written.has(full) && !/^(sdkconfig(\.old)?|build\.log|dependencies\.lock)$/.test(e.name)) fs.rmSync(full);
          }
        }
      }
    }
  }
}

// drop projects that no longer exist in the content
if (fs.existsSync(OUT)) {
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (e.isDirectory() && !manifest.some((m) => m.id === e.name && !m.skip)) fs.rmSync(path.join(OUT, e.name), { recursive: true, force: true });
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'ids.txt'), manifest.filter((m) => !m.skip).map((m) => m.id).join('\n') + '\n');

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
} else {
  const pad = (s, n) => String(s).padEnd(n);
  for (const m of manifest) {
    console.log(`${pad(m.id, 26)} ${pad(m.blockKind, 9)} ${pad(m.status || '-', 12)} ${m.skip ? 'SKIP: ' + m.skip : `${m.lines} lines, main CMake: ${m.cmakeMain}`}`);
  }
  const n = manifest.filter((m) => !m.skip).length;
  console.log(`\n${manifest.length} listings define app_main; ${n} projects written to ${path.relative(process.cwd(), OUT) || '.'}/, ${manifest.length - n} skipped.`);
}
