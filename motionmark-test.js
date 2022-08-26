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

async function startBrowser({lowPower, metal, staged, forced, managed, dynamicManaged, managedStaging}) {
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
      ...(dynamicManaged && {ANGLE_USE_DYNAMIC_MANAGED_BUFFERS: "1"}),
      ...(managedStaging && {ANGLE_USE_MANAGED_STAGING_BUFFERS: "1"}),
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

  const url = `https://browserbench.org/MotionMark1.2/developer.html`;
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

  async function applyTestSettings(settings) {
    await page.evaluate(`
    (function applySettings(settings) {
      for (const [id, value] of Object.entries(settings)) {
        const elem = document.getElementById(id);
        if (elem) {
          elem.value = value;
        }
      }
    })(${JSON.stringify(settings)});
    `);
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
  if (args.test) {
    await applyTestSettings({'test-interval': 5});
  }
  await page.evaluate('window.benchmarkController.startBenchmark()');
  verboseLog(`Running ${numTests} tests.`);
  const results = await getResults();

  return results;
}

async function getGPUs({metal}) {
  const gpus = new Map();

  for (let i = 0; i < 2; ++i) {
    const lowPower = !!i;
    const browser = await startBrowser({
      metal,
      lowPower, 
    });
    const page = await loadPage(browser);
    const gpu = await getGPU(page);
    gpus.set(gpu.RENDERER, {lowPower, metal});
    await browser.close();
  }
  return Object.fromEntries(gpus.entries());
}

async function test(initialPort = 3000) {
  try {
    // const {server, port} = await startServer(initialPort);
    const allResults = {}

    console.log('Enumerating GPUs by backing...');
    const metalGPUs = await getGPUs({metal: true});
    const glGPUs = await getGPUs({metal: false});

    console.log('Running tests...');

    const tests = [];
    for (const [gpu, {lowPower}] of Object.entries(metalGPUs)) {
      for (let i = 0; i < 16; ++i) {
        const staged = !!(i & 1);
        const forced = !!(i & 2);
        const managed = !!(i & 4);
        const dynamicManaged = !!(i * 8);
        const metal = true;
        tests.push({staged, forced, managed, lowPower, metal, dynamicManaged, managedStaging: false});
        if (staged) {
          tests.push({staged, forced, managed, lowPower, metal, dynamicManaged, managedStaging: true});
        }
      }
    }
    for (const [gpu, {lowPower}] of Object.entries(glGPUs)) {
      tests.push({lowPower, metal: false});
    }

    for (const test of tests) {
      const {staged, forced, managed, dynamicManaged, managedStaging} = test;
      const browser = await startBrowser(test);
      const page = await loadPage(browser);
      const gpu = await getGPU(page);

      const key = `${gpu.RENDERER}:${staged ? 'staged' : 'vk'}:${forced ? 'forced' : '(non-forced)'}:${managed ? 'managed' : 'shared'}:${dynamicManaged ? 'dyn-managed' : 'dyn-shared'}:${managedStaging ? 'st-managed' : 'st-shared'}`;
      console.log(`> ${key}`);

      const results = await runTests(page);
      allResults[key] = {
        ...test,
        results,
      };

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
