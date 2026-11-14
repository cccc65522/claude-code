// The editable document model. Everything here is plain JSON so a project can be
// saved, exported and shared as-is.

/** Quarter turns clockwise. 0 = signal flows left → right (inputs west, outputs east). */
export type Rot = 0 | 1 | 2 | 3;

export type GateKind = 'buf' | 'not' | 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor';

export type PartKind =
  | 'in' // input pin: a toggle switch at the top level, an interface pin inside a chip
  | 'out' // output pin
  | 'button' // momentary push button
  | 'clock'
  | 'const'
  | 'led'
  | 'hex' // 4-bit hexadecimal display
  | 'seg7' // seven-segment display
  | GateKind
  | 'tri' // tri-state buffer
  | 'mux' // 2:1 multiplexer
  | 'dff'
  | 'jkff'
  | 'tff'
  | 'chip' // instance of a user-defined circuit
  | 'text'; // annotation

export interface Part {
  id: string;
  kind: PartKind;
  /** Grid position of the top-left corner of the (rotated) bounding box. */
  x: number;
  y: number;
  rot: Rot;
  label?: string;
  /** Number of inputs (gates). */
  n?: number;
  /** Constant value, or the current value of an input switch. */
  value?: 0 | 1;
  /** Clock: the output flips every `period` ticks. */
  period?: number;
  /** LED colour name. */
  color?: string;
  /** Chip instance: id of the circuit it instantiates. */
  chip?: string;
  /** Annotation text. */
  text?: string;
  /** Challenge mode: part cannot be moved away or deleted. */
  locked?: boolean;
  /** Keyboard key that toggles an input / holds a button (a–z or 0–9). */
  key?: string;
}

export interface PinRef {
  part: string;
  pin: string;
}

export interface Wire {
  id: string;
  a: PinRef;
  b: PinRef;
  /** Position of the wire's middle segment (x or y, see geometry.bendAxis); automatic when absent. */
  bend?: number;
}

export interface Circuit {
  id: string;
  name: string;
  parts: Part[];
  wires: Wire[];
}

export interface Project {
  version: 1;
  main: Circuit;
  /** User-defined chips. Each is a circuit whose `in`/`out` parts form its interface. */
  chips: Circuit[];
}

export const MAIN_ID = 'main';
