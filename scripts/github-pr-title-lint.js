/* eslint max-len: 0 */

import https from 'https';
import {execSync} from 'child_process';

import {decode} from 'html-entities';
import shelljs from 'shelljs';

const {
  // Set by circleci on pull request jobs, and it contains the entire url, e.g.:
  //    CIRCLE_PULL_REQUEST='https://github.com/mozilla/web-ext/pull/89'
  CIRCLE_PULL_REQUEST,

  // To be set to test changes to the PR title linting by forcing it temporarily
  // (the PR #89 linked above is one that is supposed to fail the linting,
  // PR #79 title should instead pass the linting checks), e.g. the following
  // command can be used to test an expected linting failure:
  //
  //    CIRCLE_PULL_REQUEST='https://github.com/mozilla/web-ext/pull/89' \
  //    TEST_FORCE_PR_LINT=1 npm run github-pr-title-lint
  TEST_FORCE_PR_LINT,
  VERBOSE,
} = process.env;


const DONT_PANIC_MESSAGE = `
Don't panic! If the CI job is failing here, please take a look at

 - https://github.com/mozilla/web-ext/blob/master/CONTRIBUTING.md#writing-commit-messages

and feel free to ask for help from one of the maintainers in a comment; we are here to help ;-)
`;

function findMergeBase() {
  const res = shelljs.exec('git merge-base HEAD origin/master', {silent: true});

  if (res.code !== 0) {
    throw new Error(`findMergeBase Error: ${res.stderr}`);
  }

  const baseCommit = res.stdout.trim();
  if (VERBOSE === 'true') {
    console.log('DEBUG findMergeBase:', baseCommit);
  }

  return baseCommit;
}

function getGitBranchCommits() {
  const baseCommit = findMergeBase();
  const gitCommand = `git rev-list --no-merges HEAD ^${baseCommit}`;

  const res = shelljs.exec(gitCommand, {silent: true});

  if (res.code !== 0) {
    throw new Error(`getGitBranchCommits Error: ${res.stderr}`);
  }

  const commits = res.stdout.trim().split('\n');
  if (VERBOSE === 'true') {
    console.log('DEBUG getGitBranchCommits:', commits);
  }

  return commits;
}

function getGitCommitMessage(commitSha1) {
  const res = shelljs.exec(`git show -s --format=%B ${commitSha1}`, {silent: true});

  if (res.code !== 0) {
    throw new Error(`getGitCommitMessage Error: ${res.stderr}`);
  }

  const commitMessage = res.stdout.trim();
  if (VERBOSE === 'true') {
    console.log(`DEBUG getGitCommitMessage: "${commitMessage}"`);
  }

  return commitMessage;
}

function getPullRequestTitle() {
  return new Promise(function(resolve, reject) {
    const pullRequestURL = CIRCLE_PULL_REQUEST;
    const pullRequestNumber = pullRequestURL.split('/').pop();

    if (!/^\d+$/.test(pullRequestNumber)) {
      reject(new Error(`Unable to parse pull request number from ${pullRequestURL}`));
      return;
    }

    console.log(`Retrieving the pull request title from ${pullRequestURL}\n`);

    var req = https.get(pullRequestURL, {
      headers: {
        'User-Agent': 'GitHub... your API can be very annoying ;-)',
      },
    }, function(response) {
      if (response.statusCode < 200 || response.statusCode > 299 ) {
        reject(new Error(`getPullRequestTitle got an unexpected statusCode: ${response.statusCode}`));
        return;
      }

      response.setEncoding('utf8');

      var body = '';
      response.on('data', function(data) {
        try {
          body += data;

          if (VERBOSE === 'true') {
            console.log('DEBUG getPullRequestTitle got data:', String(data));
          }

          // Once we get the closing title tag, we can read the pull request title and
          // close the http request.
          if (body.includes('</title>')) {
            response.removeAllListeners('data');
            response.emit('end');

            var titleStart = body.indexOf('<title>');
            var titleEnd = body.indexOf('</title>');

            // NOTE: page slice is going to be something like:
            // "<title> PR title by author · Pull Request #NUM · mozilla/web-ext · GitHub"
            var pageTitleParts = body.slice(titleStart, titleEnd)
              .replace('<title>', '')
              .split(' · ');

            // Check that we have really got the title of a real pull request.
            var expectedPart1 = `Pull Request #${pullRequestNumber}`;

            if (pageTitleParts[1] === expectedPart1) {
              // Remove the "by author" part.
              var prTitleEnd = pageTitleParts[0].lastIndexOf(' by ');
              resolve(pageTitleParts[0].slice(0, prTitleEnd));
            } else {
              if (VERBOSE === 'true') {
                console.log('DEBUG getPullRequestTitle response:', body);
              }

              reject(new Error('Unable to retrieve the pull request title'));
            }

            req.abort();
          }
        } catch (err) {
          reject(err);
          req.abort();
        }
      });
      response.on('error', function(err) {
        console.error('Failed during pull request title download: ', err);
        reject(err);
      });
    });
  }).then((message) => {
    return decode(message, {level: 'all'});
  });
}

function lintMessage(message) {
  if (!message) {
    throw new Error('Unable to lint an empty message.');
  }

  try {
    return execSync('commitlint', {
      input: message,
      windowsHide: true,
      encoding: 'utf-8',
    }).trim();
  } catch (e) {
    // execSync failure or timeouts.
    if (e.error) {
      throw e.error;
    }

    // commitlint non-zero exit
    if (e.status) {
      // stderr by default will be output to the parent process' stderr and so we just throw stdout (See
      // https://nodejs.org/api/child_process.html#child_process_child_process_execsync_command_options)
      throw e.stdout.trim();
    }
  }
}

async function runChangelogLinting() {
  try {
    const commits = getGitBranchCommits();
    let message;

    if (commits.length === 1 && !TEST_FORCE_PR_LINT) {
      console.log('There is only one commit in this pull request,',
                  'we are going to check the single commit message...');
      message = getGitCommitMessage(commits[0]);
    } else {
      console.log('There is more than one commit in this pull request,',
                  'we are going to check the pull request title...');

      message = await getPullRequestTitle();
    }

    lintMessage(message);
  } catch (err) {
    var errMessage = `${err.stack || err}`.trim();
    console.error(`Failures during changelog linting the pull request:\n\n${errMessage}`);
    console.log(DONT_PANIC_MESSAGE);
    process.exit(1);
  }

  console.log('Changelog linting completed successfully.');
}

if (CIRCLE_PULL_REQUEST) {
  runChangelogLinting();
} else {
  console.log('This isn\'t a "GitHub Pull Request" CI job. Nothing to do here.');
}
