const BlinkDiff = require('blink-diff');
const open = require('open');
const glob = require('glob');
const path = require('path');
const fs = require('fs');

const pkgInfo = require('./package.json');

const USAGE_INFO = `
${pkgInfo.name} v${pkgInfo.version}

Usage:
  ${pkgInfo.name} [SCREENSHOTS_DIRECTORY] [--open]

Snapshots:

- Import and call \`await snapshot(t)\` within your tests, e.g. \`import { snapshot } from '${pkgInfo.name}';\`
- Run testcafe with \`--snapshot\` to take the base screenshots, run again without \`--snapshot\` to take actual screenshots
- Run ${pkgInfo.name} to generate a report from the taken screenshots, e.g. \`npx ${pkgInfo.name} tests/screenshots --open\`
`;

if (!process.argv.slice(2).length) {
  console.log(USAGE_INFO);
  process.exit();
}

const imagesPath = path.resolve(process.argv.slice(2)[0] || 'screenshots');

console.log('Processing screenshots...');

const images = glob
  .sync('**/*.png', { cwd: imagesPath })
  .filter(x => x.indexOf('thumbnails') === -1 && x.indexOf('_out.png') === -1)
  .reduce((prev, cur) => {
    const groupedName = cur.match(/_(actual|base)\.png$/);
    const fixedName = cur.replace(groupedName[0], '')
      .replace('__or__', '/')
      .replace(/_/g, ' ');

    if (!prev[fixedName]) {
      prev[fixedName] = {};
    }

    prev[fixedName][groupedName[1]] = path.join(imagesPath, cur);

    return prev;
  }, {});

const ratio = parseFloat(process.env.THRESHOLD_PERCENT || '0.01');

function build() {
  const data = [];

  Object.keys(images).forEach(groupedName => {
    if (!(images[groupedName].base && images[groupedName].actual)) {
      throw new Error(`Missing snapshots for '${groupedName}'`);
    }

    const diff = new BlinkDiff({
      imageAPath: images[groupedName].base,
      imageBPath: images[groupedName].actual,

      thresholdType: BlinkDiff.THRESHOLD_PERCENT,
      threshold: ratio,

      // FIXME: reduce usage of this by improving the UI?
      // composition: false,

      imageOutputPath: images[groupedName].base.replace('_base.png', '_out.png'),
    });

    data.push(new Promise((resolve, reject) => {
      diff.run((error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            thumbnails: {
              actual: `thumbnails/${path.relative(imagesPath, images[groupedName].actual)}`,
              base: `thumbnails/${path.relative(imagesPath, images[groupedName].base)}`,
            },
            images: {
              actual: path.relative(imagesPath, images[groupedName].actual),
              base: path.relative(imagesPath, images[groupedName].base),
              out: path.relative(imagesPath, images[groupedName].base.replace('_base.png', '_out.png')),
            },
            label: groupedName,
            diff: result.differences,
            ok: diff.hasPassed(result.code),
          });
        }
      });
    }));
  });

  return Promise.all(data);
}

function render(reportInfo) {
  return fs.readFileSync(`${__dirname}/index.html`).toString()
    .replace('{json}', JSON.stringify(reportInfo))
    .replace('{code}', `!function() { ${fs.readFileSync(`${__dirname}/report.js`)} }()`);
}

Promise.resolve()
  .then(() => build())
  .then(results => {
    const destFile = `${imagesPath}/index.html`;

    fs.writeFileSync(destFile, render(results));

    console.log(`Write ${path.relative(process.cwd(), destFile)}`); // eslint-disable-line

    if (process.argv.slice(2).indexOf('--open') !== -1) {
      open(destFile);
    }
  })
  .catch(e => {
    console.error(e.message); // eslint-disable-line
    process.exit(1);
  });
