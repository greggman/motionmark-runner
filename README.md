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

note: when I ran these I followed these step

1. Disconnect from external monitors
2. Reboot
3. Quit all other apps (Chrome auto launches on my machine so quit that)
4. Use Activity Monitor to wait for all processes to use less than 10% cpu. This can take 2 or 3 minutes as MRT and other security related stuff run
5. run the command above.
6. Move the terminal window to the right so it doesn't cover Chromium (voodoo)

## Show results

```sh
node format-results.js <json-file>
```

You can also output to csv

```sh
node format-results.js --format=csv > somefile.csv
```

## File Format

```
{
  // for each gpu:options
  "<gpu-option-key>": {  // gl.VENDOR:options
    staged: bool,
    forced: bool,
    managed: bool,
    lowPower: bool,
    metal: bool,
    results: {
      testsResults: {
        // for each suite
        "MotionMark": {   // name of suite
          // for each test
          "Multiply": {   // name of test
            ...
            score: num,
            scoreLowerBound: num,
            scoreUpperBound: num,
          },
        },
      },
    },
  },
}
```
