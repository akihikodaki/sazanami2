# Sazanami2

## Introduction

**Sazanami2** is a visualization tool that plots the numeric values in each CSV/TSV row as coordinates, typically by mapping selected columns to axes (e.g., x and y). Other columns can be used for color.

It smoothly loads gigabyte-scale files, and zooming and scrolling remain fluid even when working with very large datasets.

It is a single, self-contained HTML file that runs entirely in your browser. You can build the HTML from source or use it directly:

* Latest: [https://shioyadan.github.io/sazanami2/unstable/](https://shioyadan.github.io/sazanami2/unstable/)
* Stable: [https://shioyadan.github.io/sazanami2/](https://shioyadan.github.io/sazanami2/)

## File Format

* The tool supports CSV and TSV input files.
    * The first row is the header, with column names separated by commas or tabs.
    * From the second row onward, place the data for each column.
* The tool accepts integers (decimal and hexadecimal) and strings.
    * For string columns, IDs are assigned in order of first appearance. These IDs are used for coloring and related features.
* For example, the file below plots four points:
    ```
    y,x,s
    1,2,XX
    2,4,YY
    2,1,ZZ
    4,5,AA
    ```

## Features

* Sazanami2 can load Zstandard compressed files (`.zst`).
* Sazanami2 can read a data file from a server via a URL query parameter. This is intended for hosting the HTML file alongside the data on a server.
    ```
    https://shioyadan.github.io/sazanami2/index.html?file=log.zst
    ```

## Development

This project targets Node.js 18 on Ubuntu 24.04. If you encounter compatibility issues, use the provided Docker environment based on an Ubuntu 24.04 image.

```bash
# Initialize Node modules
make init

# Build the project
# If the build completes successfully, dist/index.html will be generated.
make production

# Build debug version
make

# Launch the development server
make serve

# Build a Docker environment
make docker-build

# Enter the Docker environment
make docker-run

# Alternatively, after setting up the Docker environment, you can run 'make' or other commands directly.
./docker/run.sh make
```

## License

Copyright (C) 2025 Ryota Shioya <shioya@ci.i.u-tokyo.ac.jp>

This application is released under the 3-Clause BSD License, see LICENSE.md. This application bundles third-party packages in accordance with the licenses presented in THIRD-PARTY-LICENSES.md.
