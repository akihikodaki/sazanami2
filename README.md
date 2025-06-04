# Sazanami2


## Development

This project is designed for development using Node.js (version 18) on Ubuntu 24.04. If you encounter compatibility issues, it is recommended to use the following Docker environment, which is based on an Ubuntu 24.04 image.

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

# Alternatively, after setting up the Docker environment, you can launch 'make' or other commands directly.
./docker/run.sh make
```

## License

Copyright (C) 2025-2025 Ryota Shioya <shioya@ci.i.u-tokyo.ac.jp>

This application is released under the 3-Clause BSD License, see LICENSE.md. This application bundles third-party packages in accordance with the licenses presented in THIRD-PARTY-LICENSES.md.
