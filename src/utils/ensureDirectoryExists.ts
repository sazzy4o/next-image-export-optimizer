import fs from "fs";
import path from "path";

async function ensureDirectoryExists(filePath: string) {
  const dirName = path.dirname(filePath);
  if (fs.existsSync(dirName)) {
    return true;
  }
  await ensureDirectoryExists(dirName);
  return fs.promises.mkdir(dirName).catch((err) => {
    if (err.code == 'EEXIST') return null;
    throw err; 
  });
}
module.exports = ensureDirectoryExists;
