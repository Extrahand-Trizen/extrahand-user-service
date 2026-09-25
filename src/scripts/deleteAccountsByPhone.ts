/**
 * Preview, then optionally delete partner/helper accounts and linked task data.
 *
 * Preview:
 *   npx ts-node src/scripts/deleteAccountsByPhone.ts 9010753557
 * Execute eligible records:
 *   npx ts-node src/scripts/deleteAccountsByPhone.ts 9010753557 --execute
 * Force deletion of tasks with active work:
 *   npx ts-node src/scripts/deleteAccountsByPhone.ts 9010753557 --execute --force
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

const ACTIVE_TASK_STATUSES = ['assigned', 'started', 'in_progress', 'review'];
const TARGET_ROLES = ['partner', 'tasker'];

function last10Digits(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function objectId(value: unknown): mongoose.Types.ObjectId | null {
  const text = String(value || '');
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
}

async function main() {
  const phone = process.argv[2];
  const execute = process.argv.includes('--execute');
  const force = process.argv.includes('--force');
  const last10 = last10Digits(phone);

  if (!phone || last10.length !== 10) {
    throw new Error('Usage: deleteAccountsByPhone.ts <10-digit-phone> [--execute] [--force]');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'extrahand' });
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB database connection is unavailable');

  const phoneRegex = new RegExp(`${last10}$`);
  const profiles = await Profile.find({
    $or: [
      { phone: phoneRegex },
      { alternatePhone: phoneRegex },
      { phoneNumber: phoneRegex } as never,
      { mobile: phoneRegex } as never,
    ],
  }).lean();

  const targetProfiles = profiles.filter((profile) =>
    (profile.roles || []).some((role) => TARGET_ROLES.includes(role)),
  );
  const profileIds = targetProfiles
    .map((profile) => objectId(profile._id))
    .filter((value): value is mongoose.Types.ObjectId => value !== null);
  const profileIdStrings = profileIds.map(String);
  const uids = targetProfiles.map((profile) => profile.uid).filter(Boolean);

  const tasks = profileIds.length === 0
    ? []
    : await db.collection('tasks').find({
        $or: [
          { requesterId: { $in: profileIds } },
          { assigneeId: { $in: profileIds } },
          { requesterUid: { $in: uids } },
          { assigneeUid: { $in: uids } },
        ],
      }).project({ _id: 1, title: 1, status: 1, requesterId: 1, assigneeId: 1 }).toArray();

  const taskIds = tasks.map((task) => task._id);
  const activeTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(String(task.status)));
  const applicationFilters = [
    ...(profileIds.length ? [{ applicantId: { $in: profileIds } }] : []),
    ...(taskIds.length ? [{ taskId: { $in: taskIds } }] : []),
  ];
  const applications = applicationFilters.length === 0
    ? 0
    : await db.collection('taskapplications').countDocuments({ $or: applicationFilters });

  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'preview',
    phone: last10,
    matchingProfiles: profiles.map((profile) => ({
      id: String(profile._id),
      uid: profile.uid,
      name: profile.name,
      phone: profile.phone,
      roles: profile.roles,
      isActive: profile.isActive,
    })),
    targetedProfiles: targetProfiles.length,
    tasks: tasks.map((task) => ({ id: String(task._id), title: task.title, status: task.status })),
    activeTaskCount: activeTasks.length,
    linkedApplicationCount: applications,
  }, null, 2));

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to delete eligible records.');
    return;
  }

  if (targetProfiles.length === 0) {
    console.log('No partner/helper profiles matched; nothing deleted.');
    return;
  }

  if (activeTasks.length > 0 && !force) {
    throw new Error(
      `${activeTasks.length} active task(s) found. Re-run with --force only after confirming those tasks should be deleted.`,
    );
  }

  const deletionFilter = profileIds.length ? { $in: profileIds } : { $in: [] };
  const taskFilter = taskIds.length ? { $in: taskIds } : { $in: [] };
  const results: Record<string, number> = {};

  results.tasks = (await db.collection('tasks').deleteMany({ _id: taskFilter })).deletedCount;
  results.taskApplications = (await db.collection('taskapplications').deleteMany({
    $or: [{ applicantId: deletionFilter }, { taskId: taskFilter }],
  })).deletedCount;
  results.reviews = (await db.collection('reviews').deleteMany({
    $or: [{ reviewerId: deletionFilter }, { reviewedId: deletionFilter }],
  })).deletedCount;
  results.taskFollows = (await db.collection('taskfollows').deleteMany({ userId: { $in: uids } })).deletedCount;
  results.taskReports = (await db.collection('taskreports').deleteMany({ userId: deletionFilter })).deletedCount;
  results.taskQuestions = (await db.collection('taskquestions').deleteMany({
    $or: [{ askedById: deletionFilter }, { answeredById: deletionFilter }],
  })).deletedCount;
  results.profiles = (await db.collection('profiles').deleteMany({ _id: deletionFilter })).deletedCount;

  const rulesResult = await db.collection('assignmentmanagementrules').updateMany(
    {},
    {
      $pull: {
        preferredPartners: {
          $or: [
            { profileId: { $in: profileIdStrings } },
            { uid: { $in: uids } },
            { phone: phoneRegex },
          ],
        },
      },
    } as never,
  );
  results.assignmentRulesUpdated = rulesResult.modifiedCount;

  console.log('\nDeletion completed:');
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });