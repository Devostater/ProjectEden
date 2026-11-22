import { restoreBackup } from './backup-archive.mjs';

const [archive, destination, ...extra] = process.argv.slice(2);
if (!archive || !destination || extra.length) {
  console.error('Usage: node scripts/restore-backup.mjs "<backup.zip>" "<new scratch folder>"');
  process.exitCode = 1;
} else {
  try {
    await restoreBackup(archive, destination);
    console.log(`Restored the backup into "${destination}".`);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Choose a scratch folder that does not already exist.' : error.message);
    process.exitCode = 1;
  }
}
