#!/usr/bin/env node

/* global require, __dirname */

const puppeteer = require('puppeteer-core');
const path = require('path');
const express = require('express');
const { waitForDebugger } = require('inspector');
const fs = require('fs');
const e = require('express');
const app = express();
const makeOptions = require('optionator');
const { setFlagsFromString } = require('v8');

const optionSpec = {
  options: [
    { option: 'help', alias: 'h',     type: 'Boolean',  description: 'displays help' },
    { option: 'port', alias: 'p',     type: 'Int',      description: 'port', default: '3000' },
    { option: 'chromium',             type: 'String',   description: 'path to Chromium.app/Chrome.app', required: true},
    { option: 'outfile',              type: 'String',   description: 'JSON file to save results to', required: true},
    { option: 'test',                 type: 'Boolean',  description: 'Just run one test (for testing this script)'},
    { option: 'verbose', alias: 'v',  type: 'Boolean',  description: 'verbose'},
  ],
  prepend: `Usage: node motionmark-test.js [options]`,
  helpStyle: {
    typeSeparator: '=',
    descriptionSeparator: ' : ',
    initialIndent: 4,
  },
};
/* eslint-enable object-curly-newline */
const optionator = makeOptions(optionSpec);

let args;
try {
  args = optionator.parse(process.argv);
} catch (e) {
  console.error(e.message);
  printHelp();
}

function printHelp() {
  console.info(optionator.generateHelp());
  process.exit(1);  // eslint-disable-line
}

if (args.help) {
  printHelp();
}

const executablePath = args.chromium;
fs.writeFileSync(args.outfile, '');  // clear the file

const verboseLog = args.verbose
    ? console.log.bind(console)
    : () => {}

// This server stuff is in case we want to server stuff locally
app.use(express.static(path.dirname(__dirname)));

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      verboseLog(`Example app listening on port ${port}!`);
      resolve({server, port});
    });
  });
}

function makePromiseInfo() {
  const info = {};
  const promise = new Promise((resolve, reject) => {
    Object.assign(info, {resolve, reject});
  });
  info.promise = promise;
  return info;
}

const wait = (seconds = 1) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

async function startBrowser(staged, forced, managed, lowPower, metal) {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath,
    // userDataDir: "??",
    args: [
      '--disable-features=DialMediaRouteProvider',  // Prevents "accept incoming network connections dialog"
      '--use-cmd-decoder=passthrough',
      `--use-angle=${metal ? 'metal' : 'gl'}`,
      lowPower ? '--force_low_power_gpu' : '--force_high_performance_gpu',
    ],
    env: {
      ...(staged && {ANGLE_USE_STAGING_BUFFERS: "1"}),
      ...(managed && {ANGLE_USE_MANAGED_BUFFERS: "1"}),
      ...(forced && {ANGLE_FORCE_SPECIAL_BUFFER_HANDLING: "1"}),
    },
  });
  return browser;
}

async function loadPage(browser) {
  const page = await browser.newPage();

  page.on('console', async e => {
    const args = await Promise.all(e.args().map(a => a.jsonValue()));
    verboseLog(...args);
  });

  let waitingPromiseInfo;

  page.on('domcontentloaded', async() => {
    for(let i = 0; ; ++i) {
      const ready = await page.evaluate(() => {
        return document.querySelector("tree > li") !== undefined;
      });
      if (ready) {
        break;
      }
      await wait(1);
    }
    waitingPromiseInfo.resolve();
  });

  const url = `https://browserbench.org/MotionMark1.2/developer.html${args.test ? '?test-interval=5': ''}`;
  waitingPromiseInfo = makePromiseInfo();
  await page.goto(url);
  await waitingPromiseInfo.promise;

  return page;
}

async function getGPU(page) {
  return await page.evaluate(`
    (function() {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        RENDERER: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        VENDOR: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      };
    })();
  `);
}

async function runTests(page) {
  async function selectTestSuite(suite = 'MotionMark') {
   const numTestsSelected = await page.evaluate(`
    (function Select(benchmark) {
      const list = document.querySelectorAll('.tree > li');
      let counter = 0;
      for (const row of list) {
        const name = row.querySelector('label.tree-label').textContent;
        const checked = name.trim() === benchmark;
        const labels = row.querySelectorAll('input[type=checkbox]');
        for (const label of labels) {
          ${args.test ? 'if (counter < 3)' : ''}
          label.checked = checked;
          if (checked) { ++counter; }
        }
      }
      return counter - 2;  // Each suite has two extra checkboxes. *shrug*
    })("${suite}");
    `
    );
    return numTestsSelected;
  }

  async function getResults() {
    for(let i = 0; ; ++i) {
      const results = await page.evaluate(`
        window.benchmarkRunnerClient.results._results ?
                          window.benchmarkRunnerClient.results.results[0] :
                          undefined;
      `);
      if (results !== undefined) {
        return results;
      }
      await wait(5);
    }
  }

  const numTests = await selectTestSuite();
  if (numTests <= 0) {
    throw new Error('no tests selected');
  }
  await page.evaluate('window.benchmarkController.startBenchmark()');
  verboseLog(`Running ${numTests} tests.`);
  const results = await getResults();

  return results;
}

async function test(initialPort = 3000) {
  try {
    // const {server, port} = await startServer(initialPort);
    const allResults = {}
    const gpuKeys = new Set();

    const tests = [];
    for (let i = 0; i < 16; ++i) {
      const staged = !!(i & 1);
      const forced = !!(i & 2);
      const managed = !!(i & 4);
      const lowPower = !!(i & 8);
      const metal = true;
      tests.push({staged, forced, managed, lowPower, metal});
    }
    // add GL low_power, high_performance
    tests.push({staged: false, forced: false, managed: false, lowPower: false, metal: false});
    tests.push({staged: false, forced: false, managed: false, lowPower: true, metal: false});

    for (const test of tests) {
      const {staged, forced, managed, lowPower, metal} = test;

      const browser = await startBrowser(staged, forced, managed, lowPower, metal);
      const page = await loadPage(browser);
      const gpu = await getGPU(page);

      const key = `${gpu.RENDERER}${staged ? 'staged' : 'vk'}:${forced ? 'forced' : '(non-forced)'}:${managed ? 'managed' : 'shared'}`;

      // skip if we've seen this before (if low-power == high-performance)
      // TODO: should check this separately since as is it will launch the browser 8 times
      if (gpuKeys.has(key)) {
        continue;
      }
      gpuKeys.add(key);
      console.log(`> ${key}`);

      const results = await runTests(page);
      for (const [suite, tests] of Object.entries(results.testsResults)) {
        for (const [test, testResults] of Object.entries(tests)) {
          const byGPUResults = allResults[test] || {}
          allResults[test] = byGPUResults;
          const {score, scoreLowerBound, scoreUpperBound} = testResults;
          byGPUResults[key] = {score, scoreLowerBound, scoreUpperBound};
        }
      }

      await browser.close();

      // yes, writing the file every time incase we crash, we can at least have the results so far
      fs.writeFileSync(args.outfile, JSON.stringify(allResults));
    }

    // server.close();
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);  // eslint-disable-line
  }
}

test();
