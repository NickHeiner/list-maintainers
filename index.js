#! /usr/bin/env node

/* eslint-disable camelcase, no-console, prefer-template */

const commander = require('commander');
const packageJson = require('./package');
const logger = require('./logger');
const _ = require('lodash');
const fs = require('fs');
const parseYarnLockfile = require('yarn-lockfile');
const promiseParallelThrottle = require('promise-parallel-throttle');
const child_process = require('child_process');
const chalk = require('chalk');
const {table} = require('table');
const Progress = require('progress');

const path = require('path');
const yarnPackage = require('yarn/package');
const yarnBinPath = path.resolve(path.dirname(require.resolve('yarn/package')), yarnPackage.bin.yarn);

logger.debug({yarnBinPath});

const defaultParallelCount = 5;

const program = commander
  .version(packageJson.version)
  .option('-y, --yarn-lockfile <path/to/yarn.lock>', 'Parse the Yarn lockfile.')
  .option('-s, --sample <sample count : int>', 'For debugging purposes: only run with the first n packages.')
  .option('-p, --parallel <parallel count : int>', 
    'The throttle limit of how many parallel npm requests can be active at once. ' +
    `Defaults to '${defaultParallelCount}'.`)
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

const getMaintainers = packages => {
  const packagesToQueryFor = _.take(packages, program.sample || Infinity);
  const progressBar = new Progress(
    `Querying for package info for ${chalk.bold(packagesToQueryFor.length)} packages. ` +
    '[:bar] (:percent complete; :elapsed seconds elapsed)', 
    {total: packagesToQueryFor.length}
  );
  return promiseParallelThrottle.all(
    packagesToQueryFor.map(pkgInfo => async () => {
      logger.debug({pkgInfo});
      const maintainers = await getMaintainersForPackage(pkgInfo);
      progressBar.tick();
      return {
        ...pkgInfo,
        maintainers
      };
    }),
    {
      maxInProgress: program.parallel || defaultParallelCount, 
      failFast: false
    }
  );
};

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

const printSummary = (maintainersByPackage, maintainerPackageInfo) => {
  console.log(
    chalk.bold(path.resolve(program.yarnLockfile)) +
    ` installs ${chalk.bold(_.size(maintainerPackageInfo))} packages ` +
    `with ${chalk.bold(_.size(maintainersByPackage))} maintainers.`);
    
  const maintainersSortedByFewestPackages = _(maintainersByPackage)
    .values()
    .sortBy(({packages}) => packages.length)
    .map(({name, email, packages}) => [
      name, 
      email, 
      packages.length
    ])
    .value();

  console.log(table([
    ['Name', 'Email', 'Package Count'].map(str => chalk.cyan.bold(str)),
    ...maintainersSortedByFewestPackages
  ]));
};

(async () => {
  const packages = getPackages(_.pick(program, 'yarnLockfile'));
  logger.debug({packages});
  const maintainerPackageInfo = await getMaintainers(packages);
  logger.debug({maintainerPackageInfo});
  const maintainersByPackage = getMaintainersByPackage(maintainerPackageInfo);
  logger.debug({maintainersByPackage});
  printSummary(maintainersByPackage, maintainerPackageInfo);
})();
