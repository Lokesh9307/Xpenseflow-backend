/**
 * READ-ONLY diagnostic #2: why does the Tiffin Expense category in the
 * Expense Tracker show ~2× the Tiffin Tracker total?
 * Prints only the current user's own tiffin-related expense rows.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env')));

(async () => {
  const conn = await mongoose.createConnection(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  const db = conn.db;

  // The most recently active user (the app's owner)
  const user = await db.collection('users').findOne({}, { sort: { updatedAt: -1 }, projection: { email: 1, name: 1, autoSyncTiffin: 1, autoSyncSplit: 1 } });
  const uid = user._id;
  console.log('user:', String(uid), 'autoSyncTiffin:', !!user.autoSyncTiffin, 'autoSyncSplit:', !!user.autoSyncSplit);

  // All tiffin-ish expenses
  const rows = await db.collection('expenses')
    .find({
      userId: uid,
      $or: [
        { category: 'Tiffin Expense' },
        { syncSource: 'tiffin' },
        { title: /^Tiffin:/i },
      ],
    })
    .project({ title: 1, amount: 1, category: 1, syncSource: 1, syncRefId: 1, splitExpenseId: 1, sourceType: 1, date: 1, createdAt: 1, paymentMethod: 1 })
    .toArray();

  console.log(`\ntiffin-ish expenses: ${rows.length}`);
  let total = 0;
  for (const r of rows) {
    total += Number(r.amount || 0);
    console.log(
      `  ₹${r.amount}  ${JSON.stringify(r.title)}  cat=${r.category} src=${r.syncSource || '-'} ref=${r.syncRefId || '-'} date=${r.date ? new Date(r.date).toISOString().slice(0, 10) : '-'} created=${r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '-'}`
    );
  }
  console.log('SUM of tiffin-ish expenses:', Math.round(total * 100) / 100);

  // Duplicate syncRefIds?
  const refCounts = {};
  rows.forEach((r) => { if (r.syncRefId) refCounts[r.syncRefId] = (refCounts[r.syncRefId] || 0) + 1; });
  const dups = Object.entries(refCounts).filter(([, n]) => n > 1);
  console.log('duplicate syncRefIds:', JSON.stringify(dups));

  // The tiffin tracker's own totals for this user
  const groups = await db.collection('tiffingroups')
    .find({ $or: [{ createdBy: uid }, { 'members.userId': uid }, { 'members.email': user.email }] })
    .project({ name: 1, pricePerTiffin: 1, members: 1 })
    .toArray();
  const gids = groups.map((g) => g._id);
  const entries = await db.collection('tiffinentries')
    .find({ groupId: { $in: gids } })
    .project({ groupId: 1, date: 1, mealType: 1, quantity: 1, totalCost: 1, totalPrice: 1, memberBills: 1, baseQuantity: 1, participantMemberIds: 1, noTiffin: 1 })
    .toArray();

  // Current month totals
  const now = new Date();
  const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  let monthTotal = 0;
  let userDue = 0;
  for (const e of entries) {
    const d = new Date(e.date);
    if (d < mStart || d >= mEnd) continue;
    if (e.noTiffin || e.mealType === 'none') continue;
    monthTotal += Number(e.totalCost ?? e.totalPrice ?? 0);
    const g = groups.find((x) => String(x._id) === String(e.groupId));
    const bills = e.memberBills || {};
    for (const m of g?.members || []) {
      if (String(m.userId) === String(uid) || (m.email && m.email.toLowerCase() === user.email)) {
        userDue += Number(bills[String(m._id)] ?? 0);
      }
    }
  }
  console.log('\ntiffin tracker — month total (all members):', Math.round(monthTotal * 100) / 100);
  console.log('tiffin tracker — user share of month:', Math.round(userDue * 100) / 100);

  console.log('\n[diag2] done — read-only, nothing was written.');
  await conn.close();
  process.exit(0);
})();
