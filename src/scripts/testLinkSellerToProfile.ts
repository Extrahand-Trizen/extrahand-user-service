/**
 * ProfileService.linkSellerToProfile — merge the `seller` role (never replace
 * other roles), set sellerProfile.sellerId, resolve by uid OR verified phone,
 * fail safe on conflict, honour preview.
 *
 *   npx ts-node src/scripts/testLinkSellerToProfile.ts
 *
 * Seeds its own `idlink-*` profiles against the configured DB, cleans up. No jest.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';
import { ProfileService } from '../services/ProfileService';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  — ${extra}` : ''}`);
};

async function seedProfile(uid: string, phone: string, roles: string[]) {
  return Profile.create({
    uid,
    name: 'ID Link Test',
    phone,
    roles,
    isActive: true,
  } as never);
}

async function cleanup() {
  await Profile.deleteMany({ uid: /^idlink-/ });
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  const dbName = process.env.MONGODB_DB || 'extrahand';
  await mongoose.connect(uri, { dbName });
  console.log(`\nDB: ${dbName}\n`);
  await cleanup();

  const SELLER_A = '507f1f77bcf86cd799439011';
  const SELLER_B = '507f1f77bcf86cd799439012';

  // ── 1. Merge role by UID, keep other roles ──────────────────────────────
  console.log('1. MERGE BY UID');
  await seedProfile('idlink-uid-1', '+915551230001', ['tasker', 'partner']);
  const r1 = await ProfileService.linkSellerToProfile({ uid: 'idlink-uid-1', sellerId: SELLER_A });
  check('found by uid', r1.found && r1.matchedBy === 'uid');
  check('reports role added', r1.sellerRoleAdded === true);
  const p1 = await Profile.findOne({ uid: 'idlink-uid-1' }).lean();
  check('roles = tasker + partner + seller (merged, not replaced)',
    ['tasker', 'partner', 'seller'].every((x) => (p1?.roles ?? []).includes(x as never)) && (p1?.roles ?? []).length === 3);
  check('sellerProfile.sellerId set', (p1?.sellerProfile as { sellerId?: string })?.sellerId === SELLER_A);

  // ── 2. Idempotent ───────────────────────────────────────────────────────
  console.log('\n2. IDEMPOTENT');
  const r2 = await ProfileService.linkSellerToProfile({ uid: 'idlink-uid-1', sellerId: SELLER_A });
  check('second call: role not re-added', r2.sellerRoleAdded === false);
  const p2 = await Profile.findOne({ uid: 'idlink-uid-1' }).lean();
  check('roles unchanged (still 3)', (p2?.roles ?? []).length === 3);

  // ── 3. Recover by phone when the UID rotated ────────────────────────────
  console.log('\n3. PHONE FALLBACK (UID rotated)');
  await seedProfile('idlink-uid-2', '+915551230002', ['poster']);
  const r3 = await ProfileService.linkSellerToProfile({ uid: 'idlink-uid-2-NEW', phone: '5551230002', sellerId: SELLER_A });
  check('UID miss → matched by phone', r3.found && r3.matchedBy === 'phone');
  check('profileUid is the existing profile', r3.profileUid === 'idlink-uid-2');
  const p3 = await Profile.findOne({ uid: 'idlink-uid-2' }).lean();
  check('poster kept + seller added', ['poster', 'seller'].every((x) => (p3?.roles ?? []).includes(x as never)));

  // ── 4. Conflict — profile already linked to a different seller ──────────
  console.log('\n4. CONFLICT');
  const r4 = await ProfileService.linkSellerToProfile({ uid: 'idlink-uid-1', sellerId: SELLER_B });
  check('different sellerId → conflict, no write', r4.conflict === true && r4.existingSellerId === SELLER_A);
  const p4 = await Profile.findOne({ uid: 'idlink-uid-1' }).lean();
  check('sellerProfile.sellerId NOT overwritten', (p4?.sellerProfile as { sellerId?: string })?.sellerId === SELLER_A);

  // ── 5. Not found ────────────────────────────────────────────────────────
  console.log('\n5. NOT FOUND');
  const r5 = await ProfileService.linkSellerToProfile({ uid: 'idlink-nobody', phone: '5559999999', sellerId: SELLER_A });
  check('no uid + no phone match → found:false', r5.found === false);

  // ── 6. Preview — resolves, reports, does not write ──────────────────────
  console.log('\n6. PREVIEW');
  await seedProfile('idlink-uid-3', '+915551230003', ['tasker']);
  const r6 = await ProfileService.linkSellerToProfile({ uid: 'idlink-uid-3', sellerId: SELLER_A, preview: true });
  check('preview reports role would be added', r6.found && r6.sellerRoleAdded === true && r6.preview === true);
  const p6 = await Profile.findOne({ uid: 'idlink-uid-3' }).lean();
  check('preview did NOT write', !(p6?.roles ?? []).includes('seller' as never) && !(p6?.sellerProfile as { sellerId?: string })?.sellerId);

  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
