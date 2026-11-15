// Every interactive tool in the app. Each entry lazy-loads js/widgets/<file>.js, whose default export is
//   mount(el, props, ctx)   where ctx = { complete(), isDone(), key }
// Call ctx.complete() when the learner solves the widget's challenge; it feeds the skills matrix.
export const WIDGETS = {
  // Electronics
  'ohms-law': { title: "Ohm's law explorer", group: 'Electronics' },
  'resistor-code': { title: 'Resistor colour code', group: 'Electronics' },
  'series-parallel': { title: 'Series and parallel networks', group: 'Electronics' },
  'voltage-divider': { title: 'Voltage divider', group: 'Electronics' },
  'rc-circuit': { title: 'RC charging and debounce', group: 'Electronics' },
  'led-resistor': { title: 'LED current limiting', group: 'Electronics' },
  'transistor-switch': { title: 'Transistor and MOSFET switch', group: 'Electronics' },
  'breadboard': { title: 'Virtual breadboard', group: 'Electronics' },
  'circuit-debug': { title: 'Circuit troubleshooting', group: 'Electronics' },
  'gpio-electrical': { title: 'GPIO electrical behaviour', group: 'Electronics' },
  'pwm-lab': { title: 'PWM explorer', group: 'Electronics' },
  'adc-lab': { title: 'ADC sampling and quantisation', group: 'Electronics' },
  'signal-lab': { title: 'Analog and digital signals', group: 'Electronics' },
  // Architecture
  'mcu-block-diagram': { title: 'Microcontroller block diagram', group: 'Architecture' },
  'memory-map': { title: 'Memory map explorer', group: 'Architecture' },
  'cpu-stepper': { title: 'CPU fetch–decode–execute stepper', group: 'Architecture' },
  'interrupt-flow': { title: 'Interrupt execution', group: 'Architecture' },
  'stack-heap': { title: 'Stack, heap and static memory', group: 'Architecture' },
  'endianness': { title: 'Endianness explorer', group: 'Architecture' },
  'boot-sequence': { title: 'Boot sequence', group: 'Architecture' },
  'timer-lab': { title: 'Timers, prescalers and watchdog', group: 'Architecture' },
  'register-bits': { title: 'Register bit manipulation', group: 'Architecture' },
  // Real-time
  'rtos-scheduler': { title: 'RTOS scheduler', group: 'Real-time' },
  'race-condition': { title: 'Race condition stepper', group: 'Real-time' },
  // Firmware
  'c-lab': { title: 'Embedded C lab (interpreter)', group: 'Firmware' },
  'struct-layout': { title: 'Struct layout and alignment', group: 'Firmware' },
  'state-machine': { title: 'State machine designer', group: 'Firmware' },
  // Protocols
  'uart-terminal': { title: 'UART terminal and frame view', group: 'Protocols' },
  'i2c-visualizer': { title: 'I2C transaction visualiser', group: 'Protocols' },
  'spi-analyzer': { title: 'SPI transaction analyser', group: 'Protocols' },
  'can-arbitration': { title: 'CAN bus arbitration', group: 'Protocols' },
  'packet-explorer': { title: 'Packet structure and CRC', group: 'Protocols' },
  'logic-analyzer': { title: 'Logic analyser', group: 'Protocols' },
  'protocol-debug': { title: 'Communication troubleshooting', group: 'Protocols' },
  // Debugging and reverse engineering
  'debug-session': { title: 'GDB and OpenOCD session', group: 'Debugging' },
  'firmware-inspector': { title: 'Firmware image inspector', group: 'Debugging' },
  'disasm-lab': { title: 'Disassembly reading', group: 'Debugging' },
  // Security
  'stack-smash': { title: 'Stack buffer overflow', group: 'Security' },
  'integer-overflow': { title: 'Integer overflow', group: 'Security' },
  'timing-attack': { title: 'Timing side channel', group: 'Security' },
  'glitch-sim': { title: 'Fault injection', group: 'Security' },
  'secure-boot-chain': { title: 'Secure boot chain of trust', group: 'Security' },
  'replay-attack': { title: 'Replay attack and nonces', group: 'Security' },
  'crypto-lab': { title: 'Hashes, MACs and signatures', group: 'Security' },
  'threat-model': { title: 'Threat model worksheet', group: 'Security' },
  'vuln-device': { title: 'Vulnerable device console', group: 'Security' },
  'platform-compare': { title: 'Platform comparison lab', group: 'Competition' },
};
const cache = {};
export async function mountWidget(el, name, props = {}, ctx = {}) {
  const meta = WIDGETS[name];
  if (!meta) { el.textContent = `Unknown tool "${name}".`; return; }
  try {
    const mod = cache[name] || (cache[name] = await import(`./${name}.js`));
    mod.default(el, props, { complete() {}, isDone: () => false, key: '', ...ctx });
  } catch (e) {
    el.classList.add('widget-missing');
    el.textContent = `The “${meta.title}” tool failed to load: ${e.message}`;
    console.error(name, e);
  }
}
