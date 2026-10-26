const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Pure helpers (no DB connection required — model registration is side-effect free)
const tiffin = require('../routes/tiffin')._helpers;
const tiffinBills = require('../lib/tiffinBills');
const split = require('../routes/split')._helpers;

const group = {
  members: [
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: '111111111111111111111111', name: 'Lokesh' },
    { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', userId: '222222222222222222222222', name: 'Rohit' },
    { _id: 'cccccccccccccccccccccccc', userId: '333333333333333333333333', name: 'Amit' },
    { _id: 'dddddddddddddddddddddddd', userId: '444444444444444444444444', name: 'Sara' },
  ],
};

describe('tiffin.sanitizeSplitPayload', () => {
  it('keeps only real member ids from the mobile triple-id payload', () => {
    const res = tiffin.sanitizeSplitPayload(
      {
        baseQuantity: 3,
        splitMemberIds: [
          'aaaaaaaaaaaaaaaaaaaaaaaa',
          '111111111111111111111111', // userId variant
          '0', // array-index variant
          'bbbbbbbbbbbbbbbbbbbbbbbb',
          '1',
          '222222222222222222222222',
        ],
        extras: {
          'bbbbbbbbbbbbbbbbbbbbbbbb': 1,
          '999999999999999999999999': 2, // not a member — dropped
          '0': 3, // index key — dropped
        },
      },
      group
    );
    assert.deepEqual(res.splitMemberIds, [
      'aaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
    ]);
    assert.deepEqual(res.extras, { 'bbbbbbbbbbbbbbbbbbbbbbbb': 1 });
    assert.equal(res.baseQuantity, 3);
  });

  it('returns null without a positive base quantity or valid ids', () => {
    assert.equal(
      tiffin.sanitizeSplitPayload({ baseQuantity: 0, splitMemberIds: ['x'] }, group),
      null
    );
    assert.equal(
      tiffin.sanitizeSplitPayload({ baseQuantity: 2, splitMemberIds: ['zzz'] }, group),
      null
    );
    assert.equal(tiffin.sanitizeSplitPayload(null, group), null);
  });
});

describe('tiffin.normalizeEntryForClient', () => {
  it('gives web-created entries their mobile fields (totalPrice/extras/noTiffin/memberBills)', () => {
    // Shape exactly as myExpense writes it
    const webEntry = {
      mealType: 'lunch',
      date: new Date('2026-10-25T00:00:00.000Z'),
      quantity: 3,
      pricePerTiffin: 100,
      totalCost: 300,
      baseQuantity: 3,
      participantMemberIds: [
        'aaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbb',
        'cccccccccccccccccccccccc',
        'dddddddddddddddddddddddd',
      ],
      participantQuantities: {},
      perPersonShare: 75,
      source: 'manual',
    };
    const o = tiffin.normalizeEntryForClient(webEntry, group.members, 100);

    assert.equal(o.totalPrice, 300);
    assert.equal(o.totalCost, 300);
    assert.deepEqual(o.extras, {});
    assert.deepEqual(o.splitMemberIds, webEntry.participantMemberIds);
    assert.equal(o.noTiffin, false);
    assert.equal(o.count, 3);
    // 3 shared tiffins ÷ 4 members = ₹75 each
    assert.deepEqual(o.memberBills, {
      aaaaaaaaaaaaaaaaaaaaaaaa: 75,
      bbbbbbbbbbbbbbbbbbbbbbbb: 75,
      cccccccccccccccccccccccc: 75,
      dddddddddddddddddddddddd: 75,
    });
    assert.equal(o.perPersonShare, 75);
  });

  it('marks web "none" entries as noTiffin with zeroed bills', () => {
    const o = tiffin.normalizeEntryForClient(
      {
        mealType: 'none',
        quantity: 0,
        pricePerTiffin: 100,
        totalCost: 0,
        participantMemberIds: [],
      },
      group.members,
      100
    );
    assert.equal(o.noTiffin, true);
    assert.equal(o.totalPrice, 0);
    assert.deepEqual(o.memberBills, {});
  });

  it('keeps already-mobile-shaped entries untouched', () => {
    const mobileEntry = {
      mealType: 'dinner',
      quantity: 2,
      pricePerTiffin: 60,
      totalPrice: 120,
      totalCost: 120,
      extras: { bbbbbbbbbbbbbbbbbbbbbbbb: 1 },
      splitMemberIds: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'],
      memberBills: { aaaaaaaaaaaaaaaaaaaaaaaa: 40, bbbbbbbbbbbbbbbbbbbbbbbb: 80 },
      noTiffin: false,
    };
    const o = tiffin.normalizeEntryForClient(mobileEntry, group.members, 100);
    assert.equal(o.totalPrice, 120);
    assert.deepEqual(o.memberBills, mobileEntry.memberBills);
    assert.deepEqual(o.extras, mobileEntry.extras);
  });

  it('computes perPersonShare for legacy entries missing it', () => {
    const o = tiffin.normalizeEntryForClient(
      {
        mealType: 'lunch',
        quantity: 4,
        pricePerTiffin: 60,
        totalCost: 240,
        participantMemberIds: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'],
      },
      group.members,
      60
    );
    assert.equal(o.perPersonShare, 120);
  });
});

describe('tiffin historical expense amounts', () => {
  it('derives legacy unit prices from the recorded total, not the current group price', () => {
    const entry = {
      _id: 'eeeeeeeeeeeeeeeeeeeeeeee',
      groupId: 'ffffffffffffffffffffffff',
      date: new Date('2026-10-25T00:00:00.000Z'),
      mealType: 'lunch',
      totalCost: 360,
      baseQuantity: 3,
      participantMemberIds: [
        'aaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbb',
      ],
      participantQuantities: { aaaaaaaaaaaaaaaaaaaaaaaa: 1 },
    };

    const lowCurrentPrice = tiffinBills.calculateEntryBills(entry, 90);
    const changedCurrentPrice = tiffinBills.calculateEntryBills(entry, 200);

    assert.deepEqual(changedCurrentPrice, lowCurrentPrice);
    assert.deepEqual(changedCurrentPrice, {
      aaaaaaaaaaaaaaaaaaaaaaaa: 225,
      bbbbbbbbbbbbbbbbbbbbbbbb: 135,
    });
  });

  it('keeps same-name groups separate and only exposes unambiguous legacy matches', () => {
    const date = new Date('2026-10-25T00:00:00.000Z');
    const memberId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const groups = [
      {
        _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        name: 'Home Tiffin',
        members: [{ _id: memberId, userId: '111111111111111111111111' }],
        pricePerTiffin: 100,
      },
      {
        _id: 'cccccccccccccccccccccccc',
        name: 'Home Tiffin',
        members: [{ _id: memberId, userId: '111111111111111111111111' }],
        pricePerTiffin: 100,
      },
    ];
    const entries = [
      {
        _id: 'dddddddddddddddddddddddd',
        groupId: groups[0]._id,
        date,
        mealType: 'lunch',
        totalCost: 100,
        memberBills: { [memberId]: 25 },
      },
      {
        _id: 'eeeeeeeeeeeeeeeeeeeeeeee',
        groupId: groups[1]._id,
        date,
        mealType: 'lunch',
        totalCost: 100,
        memberBills: { [memberId]: 75 },
      },
    ];

    const truth = tiffinBills.buildUserTiffinTruth(
      groups,
      entries,
      '111111111111111111111111'
    );

    assert.equal(truth.get(`entry:${groups[0]._id}:${entries[0]._id}`), 25);
    assert.equal(truth.get(`entry:${groups[1]._id}:${entries[1]._id}`), 75);
    assert.equal(truth.has('legacy:Home Tiffin|lunch|2026-10-25'), false);
  });

  it('matches canonical expense rows using their group and entry IDs', () => {
    const entryId = 'dddddddddddddddddddddddd';
    const groupId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    assert.equal(
      tiffinBills.tiffinExpenseTruthKey({
        syncRefId: `tiffin_${entryId}_${groupId}_aaaaaaaaaaaaaaaaaaaaaaaa`,
        title: 'Tiffin: Lunch (Home Tiffin)',
        date: '2026-10-25T00:00:00.000Z',
      }),
      `entry:${groupId}:${entryId}`
    );
  });
});

describe('tiffin.toUtcMidnight', () => {
  it('normalizes any timestamp to UTC midnight of that UTC day', () => {
    assert.equal(
      tiffin.toUtcMidnight('2026-10-26T00:00:00.000Z').toISOString(),
      '2026-10-26T00:00:00.000Z'
    );
    assert.equal(
      tiffin.toUtcMidnight('2026-10-26T18:45:12.345Z').toISOString(),
      '2026-10-26T00:00:00.000Z'
    );
    const fallback = tiffin.toUtcMidnight('not-a-date');
    assert.ok(fallback instanceof Date && !Number.isNaN(fallback.getTime()));
  });
});

describe('tiffin expense sync refs', () => {
  it('matches member and legacy rows for one entry without matching another entry or group', () => {
    const pattern = tiffin.tiffinEntrySyncRefPattern(
      'aaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbb'
    );

    assert.match(
      'tiffin_aaaaaaaaaaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbb_cccccccccccccccccccccccc',
      pattern
    );
    assert.match(
      'tiffin_aaaaaaaaaaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbb',
      pattern
    );
    assert.doesNotMatch(
      'tiffin_aaaaaaaaaaaaaaaaaaaaaaaa_dddddddddddddddddddddddd_cccccccccccccccccccccccc',
      pattern
    );
    assert.doesNotMatch(
      'tiffin_aaaaaaaaaaaaaaaaaaaaaaab_bbbbbbbbbbbbbbbbbbbbbbbb_cccccccccccccccccccccccc',
      pattern
    );
  });
});

describe('split shape bridge', () => {
  const webDoc = {
    _id: 'eeeeeeeeeeeeeeeeeeeeeeee',
    groupId: 'ffffffffffffffffffffffff',
    paidBy: '111111111111111111111111',
    title: 'Weekend Pizza',
    amount: 1200,
    splitType: 'equal',
    splits: [
      { userId: '111111111111111111111111', shareAmount: 300, status: 'paid' },
      { userId: '222222222222222222222222', shareAmount: 300, status: 'unpaid' },
      { userId: '333333333333333333333333', shareAmount: 300, status: 'unpaid' },
      { userId: '444444444444444444444444', shareAmount: 300, status: 'paid' },
    ],
    createdAt: new Date('2026-10-20T10:00:00.000Z'),
  };

  it('maps web splits → mobile splitBetween/isSettled/date', () => {
    const o = split.toMobileSplitExpense(webDoc, { 'ffffffffffffffffffffffff': 'Flat 402' });
    assert.equal(o.title, 'Weekend Pizza');
    assert.equal(o.description, 'Weekend Pizza');
    assert.equal(o.splitBetween.length, 4);
    assert.equal(o.splitBetween[1].amount, 300);
    assert.equal(o.isSettled, false);
    assert.equal(o.groupName, 'Flat 402');
    assert.equal(new Date(o.date).toISOString(), '2026-10-20T10:00:00.000Z');
  });

  it('derives isSettled=true when every share is paid', () => {
    const paid = {
      ...webDoc,
      splits: webDoc.splits.map((s) => ({ ...s, status: 'paid' })),
    };
    assert.equal(split.toMobileSplitExpense(paid).isSettled, true);
  });

  it('computes equal shares with remainder distribution', () => {
    const shares = split.equalSplitShares(100, ['u1', 'u2', 'u3']);
    assert.deepEqual(
      shares.map((s) => s.shareAmount),
      [33.34, 33.33, 33.33]
    );
    const sum = shares.reduce((acc, s) => acc + s.shareAmount, 0);
    assert.equal(Math.round(sum * 100), 10000);
  });

  it('sharesOf prefers web splits over empty splitBetween', () => {
    const shares = split.sharesOf({ splits: webDoc.splits, splitBetween: [] });
    assert.equal(shares.length, 4);
    assert.equal(shares[0].amount, 300);
  });
});
