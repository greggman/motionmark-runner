
const fs = require('fs');
const makeOptions = require('optionator');

const optionSpec = {
  options: [
    { option: 'help', alias: 'h',     type: 'Boolean',  description: 'displays help' },
    { option: 'format',               type: 'String',   description: 'format to save', enum: ['text', 'csv'], default: 'text'},
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
  const apiRow = [''];
  const gpuRow = [''];
  const methodRow = [''];
  const forceRow = [''];
  const sharedRow = [''];
  const dynamicManagedRow = [''];
  const stagedManagedRow = [''];
  const separatorRow = [undefined];
  const table = [
    apiRow,
    gpuRow,
    methodRow,
    forceRow,
    sharedRow,
    dynamicManagedRow,
    stagedManagedRow,
    separatorRow,
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
      apiRow[columnNdx] = api;
      gpuRow[columnNdx] = gpu;
      methodRow[columnNdx] = includeOption(gpu, staged ? 'staged' : 'vk');
      forceRow[columnNdx] = includeOption(gpu, forced ? 'forced' : '(non-forced)');
      sharedRow[columnNdx] = includeOption(gpu, managed ? 'managed' : 'shared');
      dynamicManagedRow[columnNdx] = includeOption(gpu, dynamicManaged ? 'dyn-managed' : 'dyn-shared');
      stagedManagedRow[columnNdx] = staged ? includeOption(gpu, managedStaging ? 'st-managed' : 'st-shared') : '';
      separatorRow[columnNdx] = undefined;
    }
  }

  return table;
}

function writeAsText(table) {
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

const escapeRE = /[",\n\r ]/
function csvEscape(s) {
  const needQuotes = escapeRE.test(s);
  return needQuotes ? `"${s}"` : s;
}

function writeAsCSV(table) {
  // find separator row
  const headingRows = [];
  const dataRows = [];
  let dst = headingRows;
  for (const row of table) {
    if (row[0] === undefined) {
      dst = dataRows;
      continue;
    } else {
      dst.push(row);
    }
  }

  const headingsParts = new Array(headingRows[0].length).fill(0).map(_ => []);
  for (const row of headingRows) {
    for (let col = 0; col < row.length; ++col) {
      headingsParts[col].push(row[col]);
    }
  }
  const headers = headingsParts.map(h => h.join('\n'));
  dataRows.unshift(headers);
  const strRows = [];
  for (const row of dataRows) {
    strRows.push(row.map(v => csvEscape(v)).join(','));
  }
  console.log(strRows.join('\r\n'));
}

const data = JSON.parse(fs.readFileSync(args._[0], {encoding: 'utf-8'}));
const gpus = separateTestsByGPU(data);
for (const [gpu, data] of Object.entries(gpus)) {
  const table = printTableForTests(gpu, data);

  switch (args.format) {
    case 'text':
      writeAsText(table);
      break;
    case 'csv':
      writeAsCSV(table);
      break;
  }
}