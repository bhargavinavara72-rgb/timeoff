// Tiny JSON-file database. Every change is written to disk atomically (write temp file, then rename).
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;
const file = () => path.join(config.DATA_DIR, 'db.json');

function init(seedFn) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  if (fs.existsSync(file())) {
    db = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } else {
    db = seedFn();
    save();
  }
  return db;
}

function save() {
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file());
}

module.exports = { init, save, get: () => db };
