#! /usr/bin/env node

/* eslint-disable camelcase */

const commander = require('commander');
const packageJson = require('./package');
const logger = require('./logger');
const _ = require('lodash');
const fs = require('fs');
const parseYarnLockfile = require('yarn-lockfile');
const promiseParallelThrottle = require('promise-parallel-throttle');
const child_process = require('child_process');

const path = require('path');
const npmPackage = require('npm/package');
const npmBinPath = path.resolve(path.dirname(require.resolve('npm/package')), npmPackage.bin.npm);

const program = commander
  .version(packageJson.version)
  .option('-y, --yarn-lockfile <path/to/yarn.lock>', 'Parse the Yarn lockfile.')
  .parse(process.argv);

if (!program.yarnLockfile) {
  logger.error('No lockfile specified.');
  program.outputHelp();
  process.exit(1);
}

const parseJson = str => {
  try {
    return JSON.parse(str);
  } catch (error) {
    logger.error({error, jsonStr: str}, "JSON parse failed. Did npm return a result that wasn't json?");
    throw error;
  }
};

const getMaintainersForPackage = async ({name: packageName, version: packageVersion}) => {
  const stdout = await new Promise((resolve, reject) => {
    const command = `${npmBinPath} info ${packageName}@${packageVersion} --json`;
    child_process.exec(command, (err, stdout, stderr) => {
      if (err) {
        logger.error(
          {stderr, stdout, command}, 
          'npm command failed. Do you have an internet connection? Is the npm registry down?'
        );
        return reject(err);
      }

      resolve(stdout);
    });
  });
  return parseJson(stdout).maintainers;
};

const getPackages = ({yarnLockfile}) => {
  if (yarnLockfile) {
    const yarnLockfileContents = fs.readFileSync(yarnLockfile, 'utf-8');
    const yarnLockFileParsed = parseYarnLockfile.parse(yarnLockfileContents);
    return _.map(yarnLockFileParsed.object, (({version}, spec) => ({
      version,
      name: spec.split('@')[0]
    })));
  }
};

const getMaintainers = async packages => promiseParallelThrottle.all(
  packages.map(pkgInfo => async () => {
    const maintainers = await getMaintainersForPackage(pkgInfo);
    return {
      ...pkgInfo,
      maintainers
    };
  })
);

(async () => {
  const packages = getPackages(_.pick(program, 'yarnLockfile'));
  logger.debug({packages}, 'Found packages');
})();
