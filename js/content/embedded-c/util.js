// Small helpers shared by the Embedded C section parts.

/** C source as a raw string: backslashes stay as typed, the leading newline is dropped. */
export const C = (strings, ...vals) => String.raw(strings, ...vals).replace(/^\n/, '');

/** A c-lab widget block. */
export const clab = (props, caption) => ({ t: 'widget', name: 'c-lab', props, ...(caption ? { caption } : {}) });

/** A C code block. `status` is one of host-tested / interp / reviewed / hw / pseudo. */
export const code = (src, status, extra = {}) => ({ t: 'code', lang: 'c', code: src, status, ...extra });
