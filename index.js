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
const yarnPackage = require('yarn/package');
const yarnBinPath = path.resolve(path.dirname(require.resolve('yarn/package')), yarnPackage.bin.yarn);

logger.debug({yarnBinPath});

const program = commander
  .version(packageJson.version)
  .option('-y, --yarn-lockfile <path/to/yarn.lock>', 'Parse the Yarn lockfile.')
  .option('-s, --sample <sample count : int>', 'For debugging purposes: only run with the first n packages.')
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
    logger.error({error, jsonStr: str}, "JSON parse failed. Did yarn return a result that wasn't json?");
    throw error;
  }
};

const getMaintainersForPackage = async ({name: packageName, version: packageVersion}) => {
  const stdout = await new Promise((resolve, reject) => {
    const command = `${yarnBinPath} info ${packageName}@${packageVersion} maintainers --json`;
    logger.debug({command}, 'Executing info command');
    child_process.exec(command, (err, stdout, stderr) => {
      if (err) {
        logger.error(
          {stderr, stdout, command}, 
          'A yarn command failed. Do you have an internet connection? Is the registry down?'
        );
        return reject(err);
      }

      resolve(stdout);
    });
  });
  return parseJson(stdout).data;
};

const getPackages = ({yarnLockfile}) => {
  if (yarnLockfile) {
    const yarnLockfileContents = fs.readFileSync(yarnLockfile, 'utf-8');
    const yarnLockFileParsed = parseYarnLockfile.parse(yarnLockfileContents);
    return _.map(yarnLockFileParsed.object, (({version}, spec) => ({
      version,
      name: spec.slice(0, spec.lastIndexOf('@'))
    })));
  }
};

const getMaintainers = packages => promiseParallelThrottle.all(
  packages.map(pkgInfo => async () => {
    logger.debug({pkgInfo});
    const maintainers = await getMaintainersForPackage(pkgInfo);
    return {
      ...pkgInfo,
      maintainers
    };
  })
);

const getMaintainersByPackage = maintainerPkgInfo => {
  const maintainersByPackage = {};
  maintainerPkgInfo.forEach(({name: packageName, version, maintainers}) => {
    maintainers.forEach(({name: maintainerName, email}) => {
      if (!maintainersByPackage[email]) {
        maintainersByPackage[email] = {name: maintainerName, email, packages: []};
      }
      maintainersByPackage[email].packages.push({name: packageName, version});
    });
  });
  return maintainersByPackage;
};

(async () => {
  const packages = getPackages(_.pick(program, 'yarnLockfile'));
  logger.debug({packages});
  const maintainers = await getMaintainers(packages);
  logger.debug({maintainers});
  const maintainersByPackage = getMaintainersByPackage(maintainers);
  logger.debug({maintainersByPackage});
})();
