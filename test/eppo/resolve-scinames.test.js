import {
  deactivatedNote,
  normalizeCell,
  resolveScinameRow,
} from '../../src/eppo/resolve-scinames.js';

describe('normalizeCell', () => {
  it('trims and treats blanks as null', () => {
    expect(normalizeCell('  BEAVA  ')).toBe('BEAVA');
    expect(normalizeCell('')).toBeNull();
    expect(normalizeCell('   ')).toBeNull();
    expect(normalizeCell(null)).toBeNull();
  });
});

describe('deactivatedNote', () => {
  it('returns a hyperlink note when replacedby is set', () => {
    expect(
      deactivatedNote({
        eppocode: 'ALSOR',
        is_active: false,
        replacedby: 'ALSPO',
        prefname: 'Alisma orientale',
      }),
    ).toEqual({
      text: 'This code has been deactivated and replaced by ALSPO',
      hyperlink: 'https://gd.eppo.int/taxon/ALSOR',
    });
  });
});

describe('resolveScinameRow', () => {
  it('fills preferred name for a valid code-only row', () => {
    expect(
      resolveScinameRow(
        { providedCode: 'CERCSG' },
        {
          codeOverview: { eppocode: 'CERCSG', prefname: 'Cercospora sorghi', is_active: true },
        },
      ),
    ).toEqual([
      {
        providedCode: 'CERCSG',
        providedSciname: null,
        preferredSciname: 'Cercospora sorghi',
        note: null,
      },
    ]);
  });

  it('notes when the provided sciname is not found for a valid code', () => {
    expect(
      resolveScinameRow(
        { providedCode: 'BEAVA', providedSciname: 'Some wrong name' },
        {
          codeOverview: {
            eppocode: 'BEAVA',
            prefname: 'Beta vulgaris subsp. vulgaris var. altissima',
            is_active: true,
          },
          nameMatches: [],
        },
      ),
    ).toEqual([
      {
        providedCode: 'BEAVA',
        providedSciname: 'Some wrong name',
        preferredSciname: 'Beta vulgaris subsp. vulgaris var. altissima',
        note: 'Provided Sciname not found',
      },
    ]);
  });

  it('emits a new row when the sciname maps to a different code', () => {
    const rows = resolveScinameRow(
      { providedCode: 'RHIZCE', providedSciname: 'Cercospora sorghi' },
      {
        codeOverview: {
          eppocode: 'RHIZCE',
          prefname: 'Rhizoctonia cerealis',
          is_active: true,
        },
        nameMatches: [{ eppocode: 'CERCSG', preferred: true }],
        overviewsByCode: new Map([
          ['CERCSG', { eppocode: 'CERCSG', prefname: 'Cercospora sorghi', is_active: true }],
        ]),
      },
    );

    expect(rows).toEqual([
      {
        providedCode: 'RHIZCE',
        providedSciname: 'Cercospora sorghi',
        preferredSciname: 'Rhizoctonia cerealis',
        note: 'Provided Sciname referred to a different EPPO code resulting in one or more new rows',
      },
      {
        providedCode: 'CERCSG',
        providedSciname: 'Cercospora sorghi',
        preferredSciname: 'Cercospora sorghi',
        note: 'New row',
      },
    ]);
  });

  it('resolves name-only rows and not-found messages', () => {
    expect(
      resolveScinameRow(
        { providedSciname: 'Ustilago avenae' },
        {
          codeOverview: undefined,
          nameMatches: [{ eppocode: 'USTIAV', preferred: true }],
          overviewsByCode: new Map([
            ['USTIAV', { eppocode: 'USTIAV', prefname: 'Ustilago avenae', is_active: true }],
          ]),
        },
      ),
    ).toEqual([
      {
        providedCode: 'USTIAV',
        providedSciname: 'Ustilago avenae',
        preferredSciname: 'Ustilago avenae',
        note: null,
      },
    ]);

    expect(resolveScinameRow({ providedCode: 'XYZ' }, { codeOverview: null })).toEqual([
      {
        providedCode: 'XYZ',
        providedSciname: null,
        preferredSciname: null,
        note: 'Sorry, no results found for EPPO code',
      },
    ]);

    expect(
      resolveScinameRow({ providedSciname: '123' }, { codeOverview: undefined, nameMatches: [] }),
    ).toEqual([
      {
        providedCode: null,
        providedSciname: '123',
        preferredSciname: null,
        note: 'Sorry, no results found for provided Sciname',
      },
    ]);

    expect(
      resolveScinameRow(
        { providedCode: 'ABC', providedSciname: '321' },
        { codeOverview: null, nameMatches: [] },
      ),
    ).toEqual([
      {
        providedCode: 'ABC',
        providedSciname: '321',
        preferredSciname: null,
        note: 'Sorry, no results found',
      },
    ]);
  });
});
