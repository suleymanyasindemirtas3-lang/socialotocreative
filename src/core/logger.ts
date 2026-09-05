const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...a: unknown[]) => console.log(`[${stamp()}]`, ...a),
  step: (...a: unknown[]) => console.log(`\n[${stamp()}] ==`, ...a),
  warn: (...a: unknown[]) => console.warn(`[${stamp()}] !`, ...a),
  err: (...a: unknown[]) => console.error(`[${stamp()}] X`, ...a),
  ok: (...a: unknown[]) => console.log(`[${stamp()}] +`, ...a),
};
