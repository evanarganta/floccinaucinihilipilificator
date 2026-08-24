# floccinaucinihilipilificator.

<p align="center"> <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"> <img src="https://img.shields.io/badge/runs-in%20your%20browser-brightgreen" alt="Runs in your browser"> <img src="https://img.shields.io/badge/backend-none-lightgrey" alt="No backend"> <img src="https://img.shields.io/badge/uploads-none-lightgrey" alt="No uploads"> </p>

Give it a file size limit and it'll try to squeeze your image under it without making it look like it was compressed on some other sketchy websites that runs them through their servers first. The image stays on your device, by the way.

## Features

* Drag and drop images.
* Click to upload.
* Presets for 100 KB, 500 KB, 1 MB, etc.
* Custom target sizes if those aren't enough.
* Tries to keep the highest quality possible while staying under the limit.
* Shrinks the dimensions if lowering the quality alone isn't enough.
* JPEG, PNG, and WebP output.
* There's also an Auto format selection.
* Optional maximum width.
* Everything happens in your browser.
* Seriously, nothing gets uploaded anywhere.

## Running locally

There's no build step or anything. It's just HTML, CSS, and JavaScript. Clone the repository:

```bash id="5yjx1x"
git clone https://github.com/evanarganta/floccinaucinihilipilificator.git
cd floccinaucinihilipilificator
```

Then open `app/index.html`. Use a reasonably modern browser and you should be fine. Auto mode prefers WebP when your browser supports it and falls back to JPEG when necessary. That's it. You can use a local server if you want, but you really don't have to. 

## Project structure

```text id="0e3bvs"
floccinaucinihilipilificator/
├── app/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── favicon.svg
├── LICENSE
└── README.md
```

## License

MIT License. Do whatever you want with it, within the limits of the license and, preferably, the law. (As far as I know, the favicon shouldn't be copyrighted, since it's a .svg, I think...)
