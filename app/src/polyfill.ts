import { Buffer } from "buffer";

const target = globalThis as unknown as { Buffer?: typeof Buffer };
if (!target.Buffer) target.Buffer = Buffer;
