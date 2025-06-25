#!/bin/bash
# Clean build script that suppresses all warnings

# Suppress Node.js warnings
export NODE_NO_WARNINGS=1
export npm_config_loglevel=error

# Run the build and filter out remaining warnings
node build-native.js "$@" 2>&1 | grep -v "WriteUtf8 is deprecated" | grep -v "NODE_MODULE" | grep -v "expanded from macro" | grep -v "MakeCallback" | grep -v "deprecated"

# Get the exit status of the build command
exit ${PIPESTATUS[0]}