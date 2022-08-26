# MotionMark test

runs motionmark in Chromium with various flags via puppeteer

## Setup

Install node (recommend nvm or nvm-windows)

```
cd motionmark
npm install
```

## Run

MacOS

```sh
caffeinate -disu node motionmark-test.js --chromium=<path-to-chromium> --outfile=<json-file>
```

Example:

```sh
caffeinate -disu node motionmark-test.js --chromium=/Users/gman/src/chromium/src/out/Release/Chromium.app/Contents/MacOS/Chromium --outfile=foo.json
```

`caffeinate` is a native MacOS command that keeps your computer from sleeping and the display from going off.

## Show results

```sh
node format-results.js <json-file>
```

