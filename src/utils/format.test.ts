import { maskedPhone, prettyPhone, greetingName, flagFor, fmtInt, sameDay, splitOwnerNames, hasMultipleOwners } from './format';

describe('splitOwnerNames (co-owners in one cell)', () => {
  it('splits on & / "and" / slash / plus', () => {
    expect(splitOwnerNames('AHMED KHAN & FATIMA KHAN')).toEqual(['AHMED KHAN', 'FATIMA KHAN']);
    expect(splitOwnerNames('Ahmed and Fatima')).toEqual(['Ahmed', 'Fatima']);
    expect(splitOwnerNames('A / B / C')).toEqual(['A', 'B', 'C']);
    expect(splitOwnerNames('A + B')).toEqual(['A', 'B']);
  });
  it('leaves a single owner as one name', () => {
    expect(splitOwnerNames('Ahmed Khan')).toEqual(['Ahmed Khan']);
    expect(hasMultipleOwners('Ahmed Khan')).toBe(false);
    expect(hasMultipleOwners('Ahmed & Fatima')).toBe(true);
  });
  it('never splits a bare comma (LASTNAME, FIRSTNAME) or a name containing "and"', () => {
    expect(splitOwnerNames('KHAN, AHMED')).toEqual(['KHAN, AHMED']);
    expect(splitOwnerNames('ALEXANDER SANDS')).toEqual(['ALEXANDER SANDS']);
  });
  it('handles blanks safely', () => {
    expect(splitOwnerNames(undefined)).toEqual([]);
    expect(splitOwnerNames('   ')).toEqual([]);
  });
});

describe('phone masking (Security Playbook — lists never show a full number)', () => {
  it('masks everything except the last four digits', () => {
    const out = maskedPhone('+971501234567');
    expect(out.endsWith('4567')).toBe(true);
    expect(out).not.toContain('50123');
    expect(out).toContain('•');
  });

  it('never leaks the middle of the number', () => {
    expect(maskedPhone('+971559876543')).not.toMatch(/9876/);
  });

  it('handles a missing number safely', () => {
    expect(maskedPhone(undefined)).toBe('—');
  });
});

describe('prettyPhone (the sanctioned reveal)', () => {
  it('groups a UAE mobile for reading aloud', () => {
    expect(prettyPhone('+971501234567')).toBe('+971 50 123 4567');
  });

  it('normalises a number without the plus', () => {
    expect(prettyPhone('971501234567')).toBe('+971 50 123 4567');
  });

  it('handles a missing number', () => {
    expect(prettyPhone(undefined)).toBe('—');
  });
});

describe('greetingName', () => {
  it('skips titles and articles', () => {
    expect(greetingName('The Director')).toBe('Director');
    expect(greetingName('Dr. Amir Haddad')).toBe('Amir');
  });

  it('uses the first name normally', () => {
    expect(greetingName('Sara Malik')).toBe('Sara');
  });
});

describe('flagFor', () => {
  it('maps a known nationality to its flag', () => {
    expect(flagFor('UAE')).toBe('🇦🇪');
    expect(flagFor('india')).toBe('🇮🇳');
  });

  it('falls back to a globe for unknown or missing', () => {
    expect(flagFor('Atlantis')).toBe('🌐');
    expect(flagFor(undefined)).toBe('🌐');
  });
});

describe('misc formatting', () => {
  it('formats integers with separators', () => {
    expect(fmtInt(8528)).toBe('8,528');
  });

  // sameDay compares the LOCAL calendar day (what a broker means by "today"),
  // so these use local-time constructors rather than UTC instants.
  it('treats two times on the same local day as the same day', () => {
    expect(sameDay(new Date(2026, 6, 17, 1, 0), new Date(2026, 6, 17, 23, 0))).toBe(true);
  });

  it('treats times either side of local midnight as different days', () => {
    expect(sameDay(new Date(2026, 6, 17, 23, 0), new Date(2026, 6, 18, 1, 0))).toBe(false);
  });
});
