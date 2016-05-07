const files = require('../fs/files.js');
const fs = require("fs");
const _ = require('underscore');
const runLog = require('../runners/run-log.js');

const isDarwin = process.platform === 'darwin';

// cp -R and keep symlinks
let syncDir = function (from, to) {
  let copyFileHelper = function (from, to, mode) {
    var readStream = files.createReadStream(from);
    var writeStream = files.createWriteStream(to, { mode: mode });
    new Promise(function (resolve, reject) {
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('open', function () {
        readStream.pipe(writeStream);
      });
      writeStream.once('finish', resolve);
    }).await();
  };

  let fromStat = files.lstat(from);

  if (files.exists(to) && files.stat(to).isDirectory()) {
    files.rm_recursive(to);
  }

  files.mkdir(to, fromStat.mode);

  _.each(files.readdir(from), function (f) {
    if (isDarwin && f === '.DS_Store') {
      return;
    }

    let fullFrom = files.pathJoin(from, f);
    let fullTo = files.pathJoin(to, f);

    var stats = files.lstat(fullFrom);
    if (stats.isDirectory()) {
      syncDir(fullFrom, fullTo);
    } else if (stats.isSymbolicLink()) {
      var linkText = files.readlink(fullFrom);
      files.symlink(linkText, fullTo);
    } else {
      var mode = stats.mode;
      copyFileHelper(fullFrom, fullTo, mode);
    }
  });
};

exports.findAppDir = function (filepath) {
  let isAppDir = function (filepath) {
    return files.exists(files.pathJoin(filepath, '.meteor', 'release')) || files.exists(files.pathJoin(filepath, '.meteor-development', 'environment'));
  };

  let findUpwards = function (predicate, startPath) {
    let testDir = startPath || files.cwd();
    while (testDir) {
      if (predicate(testDir)) {
        break;
      }
      let newDir = files.pathDirname(testDir);
      if (newDir === testDir) {
        testDir = null;
      } else {
        testDir = newDir;
      }
    }
    if (!testDir) {
      return null;
    }

    return testDir;
  };

  return findUpwards(isAppDir, filepath);
};

exports.checkAndFixMeteorEnv = function (appDir) {
  const meteorDir = files.pathJoin(appDir, '.meteor');

  if (!files.exists(meteorDir)) {
    const devEnvDir = files.pathJoin(appDir, '.meteor-development');
    files.renameDirAlmostAtomically(devEnvDir, meteorDir);

    console.log("Your app's Meteor environment is corrupted and is successfully fixed.");
  }
};

exports.addOnBeforeRun = function (options) {
  const targetEnv = process.env.NODE_ENV;
  const appDir = options.projectContext.projectDir;

  runLog.log("The app will be run in '"  + targetEnv + "' environment.\n");

  let meteorDir = files.pathJoin(appDir, '.meteor');
  let envFile = files.pathJoin(appDir, '.meteor', 'environment');
  let currentEnv = files.getLinesOrEmpty(envFile);

  if (_.isEmpty(currentEnv)) {
    currentEnv = 'development';
    files.writeFileAtomically(envFile, 'development');
  } else {
    currentEnv = currentEnv[0];
  }

  if (targetEnv === currentEnv) {
    // Nothing to do
    return;
  }

  // Backup current env first
  let backupMeteorDir = files.pathJoin(appDir, '.meteor-' + currentEnv);
  files.renameDirAlmostAtomically(meteorDir, backupMeteorDir);
    
  let sourceMeteorDir = files.pathJoin(appDir, '.meteor-' + targetEnv);
  if (!files.exists(sourceMeteorDir)) {
    let candidiateMoteorDir = files.pathJoin(appDir, '.meteor-development');
    if (!files.exists(candidiateMoteorDir)) {
      candidiateMoteorDir = backupMeteorDir;
    }

    syncDir(candidiateMoteorDir, sourceMeteorDir);

    let sourceEnvFile = files.pathJoin(sourceMeteorDir, 'environment');
    files.writeFileAtomically(sourceEnvFile, targetEnv);
  }

  files.renameDirAlmostAtomically(sourceMeteorDir, meteorDir);
};