# Yaskawa V7 / V7-4X (VS mini V7, CIMR-V7*) — FabMo VFD profile notes

Template: `spindles/spindle-VFD-data/spin-PRT-yaskawaV7.json`

All register numbers below were verified live against a V7-4X on the bench
(2026-07-29) over the SiLabs USB-RS485 adapter.

## Communications

- MEMOBUS (Modbus RTU), 9600 baud, 8 data bits, 1 stop bit, **no parity**
  (factory default; parity is parameter n155: 0=even, 1=odd, 2=none).
- Slave address: parameter n153 (this drive: 1; the probe tries 1 and 2).
- **FC06 (write single register) is NOT supported** — the drive returns
  Modbus exception 1 (illegal function). All writes must use FC16 (write
  multiple registers), same as the Yaskawa V1000. The template sets
  `WRITE_SINGLE_REGISTER: 16` accordingly.

## Required drive setup (one-time, via keypad)

| Param | Value | Meaning |
|-------|-------|---------|
| n003  | 1     | Run source = control terminals (ShopBot run/stop relay) |
| n004  | 1     | Frequency source = preset reference 1 (n024) — FabMo writes n024 over MEMOBUS, same scheme the legacy ShopBot speed-control software used |
| n152  | 1     | MEMOBUS monitor frequency units = 0.01 Hz, matching n024's native unit (verified to take effect immediately, no power cycle; the template's RPM_MULT=0.6 depends on this) |
| n153  | 1     | Slave address |
| n154  | 2     | 9600 baud |
| n155  | 2     | No parity |

Address/baud/parity (n153–n155) changes may require a power cycle to take
effect; n152 applies immediately.

**Do NOT set n004=6 (communication frequency source).** It works while the
engine is polling, but the V7's MEMOBUS timeout watchdog (n151, default:
fault + stop after ~2 s of comm silence) then raises a CE fault whenever
FabMo restarts or the Pi reboots, and the latched fault blocks the terminal
run signal until reset. Observed on the bench 2026-07-29. With n004=1 the
drive tolerates comm gaps exactly like it did under the legacy software.

## Register map used by the template

| Register | Hex | Use | Units |
|----------|-----|-----|-------|
| 280 | 0x0118 | SET_FREQUENCY (n024, preset reference 1 — the active reference with n004=1) | 0.01 Hz (fixed, regardless of n152) |
| 32  | 0x0020 | READ_STATUS (unit status word) | bitfield |
| 35  | 0x0023 | TRIG_READ_FREQ / READ_FREQUENCY (freq ref monitor) | 0.01 Hz (per n152=1) |
| 36  | 0x0024 | READ_ATTAINED_FREQUENCY (output frequency) | 0.01 Hz (per n152=1) |
| 37  | 0x0025 | READ_OUTPUT_CURRENT (output current) | 0.1 A |
| 267 | 0x010B | SIGNATURE_REGISTER (n011 max frequency — always non-zero on a V7; V1000 exceptions here are irrelevant because V1000 is probed first with its own signature) | 0.1 Hz |
| 292 | 0x0124 | READ_RATED_CURRENT (n036 motor rated current) | 0.1 A |

Parameter registers are `0x0100 + n###` (e.g. n011 → 0x010B, n024 → 0x0118,
n036 → 0x0124).

`RPM_MULT = 0.6`: 2-pole spindle (RPM = Hz × 60) with 0.01 Hz registers →
RPM = reg × 0.6 on reads, reg = RPM ÷ 0.6 on writes (18,000 RPM → 30000 =
300.00 Hz). n024's register unit is fixed at 0.01 Hz, so **writes are
correct even on a factory drive that still has n152=0** — only the monitor
readback (dashboard RPM display) is off by ×10 until n152 is set to 1.

MEMOBUS writes to n024 land in RAM, take effect immediately (verified:
the frequency-reference monitor follows the write with no ENTER command),
and touch no EEPROM, so per-job speed changes don't wear the drive out
(`ENTER_REGISTER: null`). On power cycle n024 reverts to its last
keypad/EEPROM value; FabMo rewrites it on each speed command, so that's
fine.

## Probe disambiguation vs Yaskawa V1000

Both Yaskawas answer reads at monitor registers 35/36 with the same framing,
so template order + signature registers distinguish them:

- V1000 (`spin-PRS5-yaskawaD`) is probed first; its signature register 77
  (0x004D, drive capacity) returns non-zero on a V1000 but **Modbus
  exception 2 (illegal data address) on a V7** — verified live — so the
  V1000 template cleanly rejects a V7.
- The V7 template then matches via its own signature (n011 max frequency,
  0x010B), which can never be zero on a functioning drive.

## Still to verify (needs a supervised spin-up)

- Output-current register 0x0025 and its 0.1 A scaling are from the V7
  MEMOBUS manual; the drive was stopped (0 A) during bench verification.
  Run the spindle under load and sanity-check the LOAD % bar. If current
  reads wrong, registers 0x0026/0x0027 are next candidates — adjust
  READ_OUTPUT_CURRENT (and READ_LENGTH if beyond the read block).
- MIN_RPM/MAX_RPM (6000/18000) assume the usual 2-pole 220 V/300 Hz
  ShopBot spindle (matches this drive's n011=300.0 Hz, n012=220 V).
