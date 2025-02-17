/* @flow */
import {beforeEach, afterEach} from 'mocha';

import {consoleStream} from '../../src/util/logger.js';

beforeEach(function() {
  consoleStream.makeVerbose();
  consoleStream.startCapturing();
});

afterEach(function() {
  if (this.currentTest.state !== 'passed') {
    consoleStream.flushCapturedLogs();
  }
  consoleStream.stopCapturing();
});
