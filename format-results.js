
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2], {encoding: 'utf-8'}));

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

const re = /(.*?)(\w+):([a-z_()-]+):(\w+)$/i;
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
    const gpu = getGPU(vendor);
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

const columnWidths = [];
for (const row of table) {
  for (let i = 0; i < row.length; ++i) {
    if (row[i] !== undefined) {
      columnWidths[i] = Math.max(columnWidths[i] || 0, row[i].toString().length);
    }
  }
}

for (const row of table) {
  const line = [];
  for (let i = 0; i < row.length; ++i) {
    const s = row[i] === undefined ? ''.padStart(columnWidths[i], '-') : row[i];
    line.push(s.toString().padStart(columnWidths[i] + 1));
  }
  console.log(line.join(''));
}
