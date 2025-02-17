#!/usr/bin/env node

import path from 'path';

import shell from 'shelljs';
import tmp from 'tmp';

import {mochaFunctional} from './lib/mocha.js';

const pkg = JSON.parse(shell.cat('package.json'));

shell.set('-e');

const packageFileName = `${pkg.name}-${pkg.version}.tgz`;
const testProductionMode = process.env.TEST_PRODUCTION_MODE === '1';
const testLegacyBundling = process.env.TEST_LEGACY_BUNDLING === '1';

let execMochaOptions = {};

shell.exec('npm run build', testProductionMode ? {
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
} : {});

if (testProductionMode) {
  const srcDir = process.cwd();
  const destDir = tmp.tmpNameSync();
  const packageDir = tmp.tmpNameSync();
  const npmInstallOptions = ['--production'];

  if (testLegacyBundling) {
    shell.echo('\nTest in "npm legacy bundling mode"');
    npmInstallOptions.push('--legacy-bundling');
  }

  execMochaOptions = {
    env: {
      ...process.env,
      TEST_WEB_EXT_BIN: path.join(destDir, 'node_modules', 'web-ext', 'bin', 'web-ext'),
    },
  };

  shell.echo('\nPreparing web-ext production mode environment...\n');
  shell.rm('-rf', destDir, packageDir);
  shell.mkdir('-p', destDir, packageDir);
  shell.pushd(packageDir);
  shell.exec(`npm pack ${srcDir}`);
  shell.popd();
  shell.pushd(destDir);
  const pkgPath = path.join(packageDir, packageFileName);
  shell.exec(`npm install ${npmInstallOptions.join(' ')} ${pkgPath}`);
  shell.popd();
  shell.echo('\nProduction mode environment successfully created.\n');
}

let ok = mochaFunctional(execMochaOptions);

// Try to re-run the functional tests once more if they fails on a CI windows worker (#1510).
if (!ok && process.env.CI_RETRY_ONCE) {
  console.log('*** Functional tests failure on a CI window worker, trying to re-run once more...');
  ok = mochaFunctional(execMochaOptions);
}

process.exit(ok ? 0 : 1);
