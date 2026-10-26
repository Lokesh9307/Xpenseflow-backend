/**
 * Shared tiffin billing math — used by routes/tiffin.js (API responses) and
 * routes/expenses.js (expense-tracker ⇄ tiffin-tracker reconciliation).
 * Pure functions only; nothing here writes to the database.
 */

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Helper to calculate exact per-person bills from any entry (supporting web shared-split & legacy)
function calculateEntryBills(entry, pricePerUnit, groupMembers = []) {
  const price = Number(entry.pricePerTiffin || entry.price || pricePerUnit || 100);
  const bills = {};

  // 1. If explicit memberBills is populated
  if (entry.memberBills && Object.keys(entry.memberBills).length > 0) {
    Object.entries(entry.memberBills).forEach(([id, amt]) => {
      const val = typeof amt === 'object' && amt !== null ? (amt.total ?? amt.amount ?? amt.base) : amt;
      const num = parseFloat(val) || 0;
      bills[String(id)] = Math.round(num * 100) / 100;
    });
    return bills;
  }

  // 2. Web shared-split model: baseQuantity > 0 and participantMemberIds
  const baseQty = Math.floor(Number(entry.baseQuantity) || 0);
  const participantIds = Array.isArray(entry.participantMemberIds) && entry.participantMemberIds.length > 0
    ? entry.participantMemberIds.map(String)
    : (Array.isArray(entry.splitMemberIds) && entry.splitMemberIds.length > 0 ? entry.splitMemberIds.map(String) : []);

  if (baseQty > 0 && participantIds.length > 0) {
    const uniqueParticipants = [...new Set(participantIds.filter(Boolean))];
    const baseShare = Math.round(((baseQty * price) / uniqueParticipants.length) * 100) / 100;
    const extrasMap = entry.participantQuantities || entry.extras || {};

    uniqueParticipants.forEach((pid) => {
      bills[pid] = (bills[pid] || 0) + baseShare;
    });

    Object.entries(extrasMap).forEach(([pid, k]) => {
      const extraCount = Math.max(0, Math.floor(Number(k) || 0));
      if (extraCount > 0) {
        bills[String(pid)] = Math.round(((bills[String(pid)] || 0) + extraCount * price) * 100) / 100;
      }
    });

    return bills;
  }

  // 3. Web per-participant quantities / participantMemberIds
  if (participantIds.length > 0) {
    const uniqueParticipants = [...new Set(participantIds.filter(Boolean))];
    const extrasMap = entry.participantQuantities || entry.extras || {};
    uniqueParticipants.forEach((pid) => {
      const count = Math.max(1, Math.floor(Number(extrasMap[pid]) || 1));
      bills[pid] = Math.round(count * price * 100) / 100;
    });
    return bills;
  }

  // 4. Participants array format
  if (Array.isArray(entry.participants) && entry.participants.length > 0) {
    const total = Number(entry.totalCost ?? entry.totalPrice ?? (price * entry.participants.length));
    const share = Math.round((total / entry.participants.length) * 100) / 100;
    entry.participants.forEach((p) => {
      const pId = String(p.memberId || p._id || p.userId);
      bills[pId] = share;
    });
    return bills;
  }

  // 5. Fallback: split totalCost / totalPrice equally across all group members
  const total = Number(entry.totalCost ?? entry.totalPrice ?? (price * (entry.quantity || entry.count || 1)));
  if (Array.isArray(groupMembers) && groupMembers.length > 0) {
    const splitShare = Math.round((total / groupMembers.length) * 100) / 100;
    groupMembers.forEach((m) => {
      const mId = String(m._id || m.userId);
      bills[mId] = splitShare;
    });
    return bills;
  }

  // 6. Single-user fallback
  const fallbackId = String(entry.userId || entry.addedBy || '0');
  bills[fallbackId] = total;
  return bills;
}

/**
 * Web-compatible shared-split payload: keep ONLY real member-subdoc ids and
 * filter extras the same way myExpense's normalizeSplitPayload does. Mobile
 * clients historically sent every id variant (`_id`, `userId`, array index)
 * which inflated the split denominator and corrupted per-member bills.
 */
function sanitizeSplitPayload(raw, group) {
  if (!raw) return null;
  const base = Math.floor(Number(raw.baseQuantity) || 0);
  if (base < 1) return null;
  const validIds = new Set(group.members.map((m) => String(m._id)));
  const ids = [
    ...new Set(
      (Array.isArray(raw.splitMemberIds) ? raw.splitMemberIds : [])
        .map((id) => String(id))
        .filter((id) => id && validIds.has(id))
    ),
  ];
  if (ids.length === 0) return null;
  const extras = {};
  if (raw.extras && typeof raw.extras === 'object') {
    for (const [id, k] of Object.entries(raw.extras)) {
      const q = Math.max(0, Math.floor(Number(k) || 0));
      if (q > 0 && validIds.has(id)) extras[id] = (extras[id] || 0) + q;
    }
  }
  return { baseQuantity: base, splitMemberIds: ids, extras };
}

/**
 * Read-time bridge between the two apps' field names. The web stores
 * { totalCost, participantMemberIds, participantQuantities, perPersonShare };
 * the mobile UI reads { totalPrice, splitMemberIds, extras, memberBills,
 * noTiffin }. This ONLY shapes API responses — stored documents are never
 * rewritten (the ledger stays untouched).
 */
function normalizeEntryForClient(entry, groupMembers = [], priceFallback = 0) {
  const o = entry && typeof entry.toObject === 'function' ? entry.toObject() : { ...(entry || {}) };
  const price = Number(o.pricePerTiffin || priceFallback || 0);
  const qty = Number(o.quantity ?? o.count ?? 1);

  if (o.totalCost === undefined || o.totalCost === null) {
    o.totalCost =
      o.totalPrice !== undefined && o.totalPrice !== null
        ? Number(o.totalPrice)
        : round2(qty * price);
  }
  if (o.totalPrice === undefined || o.totalPrice === null) {
    o.totalPrice = Number(o.totalCost);
  }
  if (!o.extras || Object.keys(o.extras).length === 0) {
    o.extras =
      o.participantQuantities && Object.keys(o.participantQuantities).length > 0
        ? { ...o.participantQuantities }
        : {};
  }
  if (!Array.isArray(o.splitMemberIds) || o.splitMemberIds.length === 0) {
    o.splitMemberIds = Array.isArray(o.participantMemberIds) ? [...o.participantMemberIds] : [];
  }
  if (!Array.isArray(o.participantMemberIds) || o.participantMemberIds.length === 0) {
    o.participantMemberIds = Array.isArray(o.splitMemberIds) ? [...o.splitMemberIds] : [];
  }
  if (o.noTiffin === undefined || o.noTiffin === null) o.noTiffin = o.mealType === 'none';
  if (o.quantity === undefined || o.quantity === null) o.quantity = o.count ?? 1;
  if (o.count === undefined || o.count === null) o.count = o.quantity ?? 1;
  if (!o.memberBills || Object.keys(o.memberBills).length === 0) {
    o.memberBills = o.noTiffin || o.mealType === 'none'
      ? {}
      : calculateEntryBills(o, price, groupMembers);
  }
  if (o.perPersonShare === undefined || o.perPersonShare === null) {
    const participants = new Set(
      [...(o.participantMemberIds || []), ...(o.splitMemberIds || [])].map(String)
    ).size;
    o.perPersonShare = participants > 0 ? round2(Number(o.totalCost) / participants) : 0;
  }
  return o;
}

/** Normalize a client-supplied date to UTC midnight (web's calendar-day key). */
function toUtcMidnight(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** "YYYY-MM-DD" key for a date value (UTC calendar day). */
function dateKey(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a synced expense title of the form "Tiffin: Lunch (Group Name)".
 * Returns { meal, groupName } or null. Group names containing parentheses
 * degrade gracefully (null → caller serves the row unchanged).
 */
function parseTiffinTitle(title) {
  const t = String(title || '');
  const m = t.match(/^Tiffin:\s*([a-zA-Z]+)\s*\((.+)\)\s*$/);
  if (!m) return null;
  return { meal: m[1].toLowerCase(), groupName: m[2] };
}

/**
 * Resolve the user's true per-meal share from the TIFFIN TRACKER itself.
 * Returns a Map of `${groupName}|${meal}|${YYYY-MM-DD}` → user's bill (₹),
 * skipping no-tiffin markers. This is the source of truth the Expense
 * Tracker's Tiffin category is reconciled against.
 */
function buildUserTiffinTruth(groups, entries, userId, userEmail) {
  const truth = new Map();
  const uid = String(userId);
  const email = String(userEmail || '').toLowerCase().trim();

  for (const g of groups) {
    const members = Array.isArray(g.members) ? g.members : [];
    const member = members.find(
      (m) =>
        (m.userId && String(m.userId) === uid) ||
        (m.email && m.email.toLowerCase().trim() === email)
    ) || null;
    const mId = member ? String(member._id) : null;
    const price = Number(g.pricePerTiffin || g.defaultPrice || 100);

    for (const e of entries) {
      if (String(e.groupId) !== String(g._id)) continue;
      const norm = normalizeEntryForClient(e, members, price);
      if (norm.noTiffin || norm.mealType === 'none') continue;

      let bill = 0;
      if (mId && norm.memberBills && Number(norm.memberBills[mId]) > 0) {
        bill = Number(norm.memberBills[mId]);
      } else if (norm.memberBills && Number(norm.memberBills[uid]) > 0) {
        bill = Number(norm.memberBills[uid]);
      } else {
        // Legacy rows without a resolvable share: split the entry total
        // across the group members, or take it whole for single-member groups.
        const total = Number(norm.totalCost ?? norm.totalPrice ?? 0);
        bill = members.length > 1 ? total / members.length : total;
      }

      const key = `${g.name}|${String(norm.mealType || '').toLowerCase()}|${dateKey(norm.date)}`;
      truth.set(key, round2(bill));
    }
  }
  return truth;
}

module.exports = {
  round2,
  calculateEntryBills,
  sanitizeSplitPayload,
  normalizeEntryForClient,
  toUtcMidnight,
  dateKey,
  parseTiffinTitle,
  buildUserTiffinTruth,
};
