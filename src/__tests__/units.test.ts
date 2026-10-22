import { describe, expect, it } from "vitest";
import { fmtLen, parseLen } from "../units";

describe("parseLen", () => {
  const cases: [string, number][] = [
    ["12'6\"", 12.5], ["12′ 6″", 12.5], ["12 ft 6 in", 12.5], ["6\"", 0.5], ["150in", 12.5],
    ["3/4\"", 0.0625], ["12' 6 1/2\"", 12 + 6.5 / 12], ["6½\"", 6.5 / 12], ["12'", 12], ["3.5", 3.5],
    ["-2'", -2], ["7' 2\"", 7 + 2 / 12], ["1m", 1 / 0.3048], ["40cm", 0.4 / 0.3048], ["12''", 1],
  ];
  for (const [s, v] of cases) it(s, () => expect(parseLen(s)).toBeCloseTo(v, 6));
  for (const s of ["", "abc", "12'x", "1/0\""]) it(`rejects ${JSON.stringify(s)}`, () => expect(parseLen(s)).toBeNull());
});

describe("fmtLen", () => {
  it("formats feet and inches", () => {
    expect(fmtLen(12.5)).toBe("12′ 6″");
    expect(fmtLen(12)).toBe("12′");
    expect(fmtLen(0.5)).toBe("6″");
    expect(fmtLen(0)).toBe("0″");
    expect(fmtLen(7 + 2 / 12)).toBe("7′ 2″");
    expect(fmtLen(6.5 / 12)).toBe("6½″");
    expect(fmtLen(11.999)).toBe("12′");
  });
  it("round-trips through parseLen", () => {
    for (const v of [0.25, 3.1, 12.5, 22, 34 / 12]) expect(parseLen(fmtLen(v))!).toBeCloseTo(v, 2);
  });
});
