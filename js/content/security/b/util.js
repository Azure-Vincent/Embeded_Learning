// Helpers shared by the part-b lesson files.

/** C source as a raw string: backslashes stay as typed, the leading newline is dropped. */
export const C = (strings, ...vals) => String.raw(strings, ...vals).replace(/^\n/, '');

/** A C code block. `status` is one of host-tested / interp / reviewed / hw / pseudo. */
export const code = (src, status, extra = {}) => ({ t: 'code', lang: 'c', code: src, status, ...extra });

/** A widget block. */
export const widget = (name, props, caption, title) => ({ t: 'widget', name, props, ...(caption ? { caption } : {}), ...(title ? { title } : {}) });

export const SCOPE = `Practice for this lesson happens in the simulation below and, if you want to go further, on a board you own. The simulated device is fictional. Nothing here is a procedure for equipment that belongs to someone else.`;
