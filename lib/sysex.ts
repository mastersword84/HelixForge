// ============================================================
// HELIXFORGE — WEB MIDI SYSEX UTILITIES
// Universal SysEx Inquiry + Line 6 manufacturer parsing.
// Foundation for direct Helix Stadium communication, bypassing
// the .hsp file importer (which can brick the device on bad input).
// ============================================================

// MIDI Universal SysEx Inquiry message — every MIDI device responds to this.
// F0  = SysEx Start
// 7E  = Universal Non-Real Time
// 7F  = Device ID (broadcast — any device replies)
// 06  = General Information sub-ID
// 01  = Identity Request
// F7  = SysEx End
export const IDENTITY_REQUEST = new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);

// Line 6 extended manufacturer ID — three bytes, leading 0x00 marks it as extended.
export const LINE6_MANUFACTURER_ID = [0x00, 0x01, 0x0c] as const;

export interface IdentityReply {
  deviceId: number;
  manufacturerId: number[];
  manufacturerName: string;
  familyCode: number;
  memberCode: number;
  versionBytes: number[];
  versionString: string;
  raw: number[];
}

export function isLine6(reply: IdentityReply): boolean {
  const m = reply.manufacturerId;
  return m.length === 3 && m[0] === 0x00 && m[1] === 0x01 && m[2] === 0x0c;
}

export function parseIdentityReply(bytes: Uint8Array): IdentityReply | null {
  if (bytes.length < 13) return null;
  if (bytes[0] !== 0xf0) return null;
  if (bytes[1] !== 0x7e) return null;
  if (bytes[3] !== 0x06 || bytes[4] !== 0x02) return null;
  if (bytes[bytes.length - 1] !== 0xf7) return null;

  const deviceId = bytes[2];

  // Manufacturer ID: 1 byte normally, or 3 bytes if first byte is 0x00.
  let mfrBytes: number[];
  let cursor: number;
  if (bytes[5] === 0x00) {
    mfrBytes = [bytes[5], bytes[6], bytes[7]];
    cursor = 8;
  } else {
    mfrBytes = [bytes[5]];
    cursor = 6;
  }

  // Family (LSB, MSB) and Member (LSB, MSB) — each 14-bit pair.
  const familyCode = bytes[cursor] | (bytes[cursor + 1] << 7);
  const memberCode = bytes[cursor + 2] | (bytes[cursor + 3] << 7);
  cursor += 4;

  // Version: 4 bytes.
  const versionBytes = [
    bytes[cursor],
    bytes[cursor + 1],
    bytes[cursor + 2],
    bytes[cursor + 3],
  ];

  return {
    deviceId,
    manufacturerId: mfrBytes,
    manufacturerName: lookupManufacturer(mfrBytes),
    familyCode,
    memberCode,
    versionBytes,
    versionString: versionBytes.join("."),
    raw: Array.from(bytes),
  };
}

function lookupManufacturer(id: number[]): string {
  if (id.length === 3 && id[0] === 0x00 && id[1] === 0x01 && id[2] === 0x0c) {
    return "Line 6";
  }
  if (id.length === 1) {
    const known: Record<number, string> = {
      0x41: "Roland",
      0x42: "Korg",
      0x43: "Yamaha",
      0x47: "Akai",
    };
    return known[id[0]] ?? `Unknown (0x${id[0].toString(16).padStart(2, "0")})`;
  }
  return "Unknown";
}

export function formatBytes(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
