import { esc } from './dom.js';
// Small C/C++ tokenizer for syntax highlighting. Also handles shell, python-ish and asm reasonably.
const KW = new Set('if else for while do switch case default break continue return goto sizeof typedef struct union enum static const volatile extern inline register void unsigned signed class public private namespace template new delete true false nullptr NULL'.split(' '));
const TY = new Set('int char short long float double bool size_t ssize_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t uintptr_t intptr_t esp_err_t TaskHandle_t QueueHandle_t SemaphoreHandle_t BaseType_t TickType_t gpio_num_t'.split(' '));
export function highlight(code, lang = 'c') {
  if (lang === 'text' || lang === 'none') return esc(code);
  const hash = lang === 'sh' || lang === 'bash' || lang === 'python' || lang === 'py' || lang === 'cmake' || lang === 'make' || lang === 'yaml' || lang === 'gdb';
  const re = hash
    ? /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[ \t]*\w+)|(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b0b[01]+\b|\b\d+(?:\.\d+)?[uUlLfF]*\b)|([A-Za-z_][A-Za-z0-9_]*)/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const t = m[0];
    if (hash) {
      if (m[1]) out += `<span class="tk-c">${esc(t)}</span>`;
      else if (m[2]) out += `<span class="tk-s">${esc(t)}</span>`;
      else if (m[3]) out += `<span class="tk-n">${esc(t)}</span>`;
      else out += esc(t);
    } else if (m[1]) out += `<span class="tk-c">${esc(t)}</span>`;
    else if (m[2]) out += `<span class="tk-s">${esc(t)}</span>`;
    else if (m[3]) out += `<span class="tk-p">${esc(t)}</span>`;
    else if (m[4]) out += `<span class="tk-n">${esc(t)}</span>`;
    else if (KW.has(t)) out += `<span class="tk-k">${t}</span>`;
    else if (TY.has(t) || /_t$/.test(t)) out += `<span class="tk-t">${t}</span>`;
    else if (/^[A-Z][A-Z0-9_]{2,}$/.test(t)) out += `<span class="tk-m">${t}</span>`;
    else if (code[re.lastIndex] === '(') out += `<span class="tk-f">${t}</span>`;
    else out += t;
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}
