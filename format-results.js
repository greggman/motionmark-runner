
const fs = require('fs');

function getAPI(s) {
  if (s.includes("OpenGL")) {
    return "OpenGL"
  } else if (s.includes("Metal")) {
    return "Metal";
  } else {
    throw new Error(`unknonw api from :${s}`);
  }
}

function getGPU(s) {
  if ((/nvidia/i).test(s)) {
    return "nvidia";
  } else if ((/intel/i).test(s)) {
    return "intel";
  } else if ((/amd/i).test(s)) {
    return "amd";
  } else if ((/m1/i).test(s)) {
    return "m1";
  } else {
    throw new Error(`unknown gpu from : ${s}`);
  }
}

const re = /(.*?)(\w+):([a-z_()-]+):(\w+)$/i;

function separateTestsByGPU(data) {
  const gpus = {};
  for (const [test, testData] of Object.entries(data)) {
    for (const [name, results] of Object.entries(testData)) {
      const m = re.exec(name);
      if (!m) {
        throw Error(`could not parse "${name}"`);
      }
      const [, vendor, method, force, shared] = m;
      const gpu = getGPU(vendor);
      const gpuTests = gpus[gpu] || [];
      gpus[gpu] = gpuTests;
      const tests = gpuTests[test] || {};
      gpuTests[test] = tests;
      tests[name] = results;
    }
  }
  return gpus;
}

function printTableForTests(gpu, data) {
  const apis = [''];
  const gpus = [''];
  const methods = [''];
  const forces = [''];
  const shareds = [''];
  const seps = [undefined];
  const table = [
    apis,
    gpus,
    methods,
    forces,
    shareds,
    seps,
  ];
  // gather data into rows of elements
  let firstRow = true;
  for (const [test, testData] of Object.entries(data)) {
    const row = [test];
    table.push(row);
    for (const [name, results] of Object.entries(testData)) {
      const m = re.exec(name);
      if (!m) {
        throw Error(`could not parse "${name}"`);
      }
      const [, vendor, method, force, shared] = m;
      const api = getAPI(vendor);
      if (firstRow) {
        apis.push(api);
        gpus.push(gpu);
        methods.push(method);
        forces.push(force);
        shareds.push(shared);
        seps.push(undefined);
      }
      row.push(results.score | 0);
    }
    firstRow = false;
  }

  // find the width of each column
  const columnWidths = [];
  for (const row of table) {
    for (let i = 0; i < row.length; ++i) {
      if (row[i] !== undefined) {
        columnWidths[i] = Math.max(columnWidths[i] || 0, row[i].toString().length);
      }
    }
  }

  // print the table (replace undefined with '-')
  for (const row of table) {
    const line = [];
    for (let i = 0; i < row.length; ++i) {
      const s = row[i] === undefined ? ''.padStart(columnWidths[i], '-') : row[i];
      line.push(s.toString().padStart(columnWidths[i] + 1));
    }
    console.log(line.join(''));
  }
  console.log('\n')
}

const data = JSON.parse(fs.readFileSync(process.argv[2], {encoding: 'utf-8'}));
const gpus = separateTestsByGPU(data);
for (const [gpu, data] of Object.entries(gpus)) {
  printTableForTests(gpu, data);
}