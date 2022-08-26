
const fs = require('fs');

function getAPI(s) {
  if (s.includes("OpenGL")) {
    return "OpenGL"
  } else if (s.includes("Metal")) {
    return "Metal";
  } else {
    throw new Error(`unknown api from :${s}`);
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

// TODO: This is dumb, the data is separated when generated
// so should store already separated.
const keyParseRE = /(.*?)(\w+):([a-z_()-]+):(\w+)$/i;

function separateTestsByGPU(data) {
  const gpus = {};
  for (const [key, testData] of Object.entries(data)) {
    const gpuKey = getGPU(key);
    const gpu = gpus[gpuKey] || {};
    gpus[gpuKey] = gpu;
    gpu[key] = testData;
  }
  return gpus;
}

function includeOption(gpu, option) {
  return gpu === 'OpenGL' ? '' : option;
}

function printTableForTests(gpu, data) {
  const apis = [''];
  const gpus = [''];
  const methods = [''];
  const forces = [''];
  const shareds = [''];
  const dynamicManaged = [''];
  const stagedManaged = [''];
  const seps = [undefined];
  const table = [
    apis,
    gpus,
    methods,
    forces,
    shareds,
    dynamicManaged,
    stagedManaged,
    seps,
  ];
  // We could assume they are in the same order which they probably are but...
  const keyToColumnIndex = new Map([['test', 0]]);
  const keyToRow = new Map();

  const getColumnByGPUKey = (key) => {
    const ndx = keyToColumnIndex.get(key);
    if (ndx !== undefined) {
      return ndx;
    }
    const newNdx = keyToColumnIndex.size;
    keyToColumnIndex.set(key, newNdx);
    return newNdx;
  }

  const getRowByTestName = (testName) => {
    let row = keyToRow.get(testName);
    if (row === undefined) {
      row = [testName];
      table.push(row);
      keyToRow.set(testName, row);
    }
    return row;
  }

  const suite = 'MotionMark';
  for (const [gpuKey, gpuData] of Object.entries(data)) {
    const columnNdx = getColumnByGPUKey(gpuKey);
    const {staged, forced, managed, dynamicManaged, managedStaging, lowPower, metal} = gpuData;
    const api = getAPI(gpuKey);

    for (const [testName, {score}] of Object.entries(gpuData.results.testsResults[suite])) {
      const row = getRowByTestName(testName);
      row[columnNdx] = score | 0;
      apis[columnNdx] = api;
      gpus[columnNdx] = gpu;
      methods[columnNdx] = includeOption(gpu, staged ? 'staged' : 'vk');
      forces[columnNdx] = includeOption(gpu, forced ? 'forced' : '(non-forced)');
      shareds[columnNdx] = includeOption(gpu, managed ? 'managed' : 'shared');
      dynamicManaged[columnNdx] = includeOptions(gpu, dynamicManaged ? 'dyn-managed' : 'dyn-shared');
      stagedManages[columnNdx] = includeOptions(gpu, managedStaging ? 'st-managed' : 'st-shared');
      seps[columnNdx] = undefined;
    }
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