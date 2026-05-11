# Copyright 2010-2025 Google LLC
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

if(NOT BUILD_NODE)
  return()
endif()

if(NOT TARGET ${PROJECT_NAMESPACE}::ortools)
  message(FATAL_ERROR "Node: missing ${PROJECT_NAMESPACE}::ortools TARGET")
endif()

# Locate Node.js + npm.
find_program(NODE_EXECUTABLE NAMES node REQUIRED)
find_program(NPM_EXECUTABLE NAMES npm REQUIRED)
message(STATUS "Found Node: ${NODE_EXECUTABLE}")
message(STATUS "Found npm: ${NPM_EXECUTABLE}")

execute_process(
  COMMAND ${NODE_EXECUTABLE} --version
  OUTPUT_VARIABLE NODE_VERSION_RAW
  OUTPUT_STRIP_TRAILING_WHITESPACE)
message(STATUS "Node version: ${NODE_VERSION_RAW}")

# Node.js 20+ ships NAPI 9. We target NAPI 9 as the baseline.
set(NODE_NAPI_VERSION 9)

# Compute the prebuild triplet. node-gyp-build expects a two-part
# `<platform>-<arch>` directory name, with libc as an in-file tag.
# Windows is not currently supported; see ortools/sat/node/CONTRIBUTING.md.
if(APPLE)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)")
    set(NODE_NATIVE_DIR "darwin-arm64")
  else()
    set(NODE_NATIVE_DIR "darwin-x64")
  endif()
  set(NODE_OUTPUT_NAME "node.napi.node")
elseif(UNIX)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)")
    set(_NODE_ARCH "arm64")
  else()
    set(_NODE_ARCH "x64")
  endif()
  # We split glibc and musl into sibling directories so both libc
  # variants can coexist in the same source tree without their
  # bundled .so files clobbering each other. The `-musl` suffix is
  # also what the runtime loader uses to pick the matching platform
  # package (`@ortools-node/cp-sat-linux-<arch>-musl`).
  if(EXISTS "/etc/alpine-release")
    set(NODE_NATIVE_DIR "linux-${_NODE_ARCH}-musl")
    set(NODE_OUTPUT_NAME "node.napi.musl.node")
  else()
    set(NODE_NATIVE_DIR "linux-${_NODE_ARCH}")
    set(NODE_OUTPUT_NAME "node.napi.glibc.node")
  endif()
else()
  message(FATAL_ERROR
    "Node: unsupported platform (Windows is not currently supported; "
    "see ortools/sat/node/CONTRIBUTING.md)")
endif()
message(STATUS "Node native dir/file: ${NODE_NATIVE_DIR}/${NODE_OUTPUT_NAME}")

set(NODE_PROJECT_DIR ${PROJECT_SOURCE_DIR}/ortools/sat/node)
set(NODE_PREBUILDS_DIR ${NODE_PROJECT_DIR}/prebuilds/${NODE_NATIVE_DIR})

# Install npm dependencies (devDeps include node-addon-api & node-api-headers).
# Capture stdout/stderr so a failure surfaces the actual npm error message
# instead of just "exit unknown error".
message(STATUS "Node: running 'npm install' in ${NODE_PROJECT_DIR}")
execute_process(
  COMMAND ${NPM_EXECUTABLE} install --no-audit --no-fund --include=dev
  WORKING_DIRECTORY ${NODE_PROJECT_DIR}
  RESULT_VARIABLE _npm_install_result
  OUTPUT_VARIABLE _npm_install_stdout
  ERROR_VARIABLE _npm_install_stderr)
if(NOT _npm_install_result EQUAL 0)
  message(FATAL_ERROR
    "Node: 'npm install' failed (exit ${_npm_install_result}).\n"
    "stdout:\n${_npm_install_stdout}\n"
    "stderr:\n${_npm_install_stderr}")
endif()
if(_npm_install_stdout)
  message(STATUS "npm install stdout: ${_npm_install_stdout}")
endif()

# Resolve include dirs from the locally-installed packages.
execute_process(
  COMMAND ${NODE_EXECUTABLE} -p
    "require('path').resolve(require('node-addon-api').include_dir)"
  WORKING_DIRECTORY ${NODE_PROJECT_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
  RESULT_VARIABLE _resolve_naa)
if(NOT _resolve_naa EQUAL 0)
  message(FATAL_ERROR "Node: failed to resolve 'node-addon-api' include dir")
endif()
message(STATUS "node-addon-api include: ${NODE_ADDON_API_DIR}")

execute_process(
  COMMAND ${NODE_EXECUTABLE} -p
    "require('path').resolve(require('node-api-headers').include_dir)"
  WORKING_DIRECTORY ${NODE_PROJECT_DIR}
  OUTPUT_VARIABLE NODE_API_HEADERS_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
  RESULT_VARIABLE _resolve_nah)
if(NOT _resolve_nah EQUAL 0)
  message(FATAL_ERROR "Node: failed to resolve 'node-api-headers' include dir")
endif()
message(STATUS "node-api-headers include: ${NODE_API_HEADERS_DIR}")

# The N-API addon: a MODULE library with a .node suffix.
set(NODE_ADDON_SOURCES
  ${NODE_PROJECT_DIR}/src/cpp/binding.cc
  ${NODE_PROJECT_DIR}/src/cpp/solve_wrapper.cc
  ${NODE_PROJECT_DIR}/src/cpp/cp_sat_helper.cc
  ${NODE_PROJECT_DIR}/src/cpp/c_api_binding.cc
)

add_library(ortools_cpsat_node MODULE ${NODE_ADDON_SOURCES})

target_include_directories(ortools_cpsat_node PRIVATE
  ${NODE_ADDON_API_DIR}
  ${NODE_API_HEADERS_DIR})

target_compile_definitions(ortools_cpsat_node PRIVATE
  NAPI_VERSION=${NODE_NAPI_VERSION}
  NODE_ADDON_API_CPP_EXCEPTIONS
  NODE_ADDON_API_DISABLE_DEPRECATED
  BUILDING_NODE_EXTENSION)

# Strip the .node extension off OUTPUT_NAME because the SUFFIX carries it.
string(REGEX REPLACE "\\.node$" "" _NODE_OUTPUT_STEM "${NODE_OUTPUT_NAME}")
set_target_properties(ortools_cpsat_node PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  POSITION_INDEPENDENT_CODE ON
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
  OUTPUT_NAME "${_NODE_OUTPUT_STEM}"
  LIBRARY_OUTPUT_DIRECTORY ${NODE_PREBUILDS_DIR}
  RUNTIME_OUTPUT_DIRECTORY ${NODE_PREBUILDS_DIR})

# Per-config output dirs (multi-config generators).
foreach(_cfg IN LISTS CMAKE_CONFIGURATION_TYPES)
  string(TOUPPER ${_cfg} _CFG)
  set_target_properties(ortools_cpsat_node PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY_${_CFG} ${NODE_PREBUILDS_DIR}
    RUNTIME_OUTPUT_DIRECTORY_${_CFG} ${NODE_PREBUILDS_DIR})
endforeach()

if(NOT MSVC)
  target_compile_options(ortools_cpsat_node PRIVATE
    -Os -fdata-sections -ffunction-sections)
endif()

# Make the .node find its bundled shared dependencies without any
# LD_LIBRARY_PATH / DYLD_FALLBACK_LIBRARY_PATH gymnastics. The bundle script
# below copies those .so / .dylib files into the same directory.
set_target_properties(ortools_cpsat_node PROPERTIES
  BUILD_WITH_INSTALL_RPATH TRUE
  INSTALL_RPATH_USE_LINK_PATH FALSE)
if(APPLE)
  # @loader_path lets the loader find the bundled .dylibs at runtime;
  # the build-time link rpath (added implicitly by target_link_libraries
  # against ortools::ortools) lets file(GET_RUNTIME_DEPENDENCIES) resolve
  # the @rpath install names of OR-Tools' transitive absl/protobuf deps.
  set_target_properties(ortools_cpsat_node PROPERTIES
    INSTALL_RPATH "@loader_path")
elseif(UNIX)
  set_target_properties(ortools_cpsat_node PROPERTIES
    INSTALL_RPATH "$ORIGIN")
endif()

# Link against the OR-Tools aggregate (which transitively pulls in CP-SAT,
# absl, protobuf, etc.).
target_link_libraries(ortools_cpsat_node PRIVATE ${PROJECT_NAMESPACE}::ortools)

# Copy the runtime-required shared libraries from the build's lib/ dir into
# prebuilds/<triplet>/ so the .node + its dependencies form a single
# self-contained directory that npm can ship.
#
# `file(GET_RUNTIME_DEPENDENCIES)` walks the .node's NEEDED entries and
# resolves each one against build_lib_dir. We invoke it via a POST_BUILD
# script (executed at build time, not configure time) so the .node exists
# when we inspect it.
# Compose the include-pattern + search-dir lists for the bundle script.
# Patterns are POSIX-ERE regexes matched against filename basenames.
# `+` in libstdc++ is a regex metacharacter; we double-escape it so the
# baked-into-the-script string contains a literal `\+` for the regex
# engine.
set(_NODE_BUNDLE_INCLUDE_PATTERNS
  "^libortools"
  "^libprotobuf"
  "^libabsl_"
  "^libutf8_validity"
  "^libre2"
  "^libCbc" "^libCgl" "^libClp" "^libCoinUtils" "^libOsi"
  "^libhighs" "^libscip" "^libsoplex"
  # OR-Tools' build can produce a bundled libbz2 (on macOS especially);
  # ship it. On Linux we usually link against the system /lib/libbz2,
  # which the LIB_DIR glob won't pick up anyway.
  "^libbz2" "^libz")

set(_NODE_BUNDLE_SEARCH_DIRS_GENEX "$<TARGET_FILE_DIR:${PROJECT_NAMESPACE}::ortools>")

# On Alpine (musl libc), bundle libstdc++ + libgcc_s alongside the
# addon. The OR-Tools Python musllinux wheel does the same thing via
# auditwheel; this matches that house style and makes the prebuild
# self-contained on any musl host (distroless musl, slimmed Alpine
# images, Void Linux musl), not just `node:20-alpine` which preinstalls
# libstdc++. The build-time location on Alpine is /usr/lib; the runtime
# $ORIGIN rpath set on the addon resolves them with no consumer action.
if(EXISTS "/etc/alpine-release")
  list(APPEND _NODE_BUNDLE_INCLUDE_PATTERNS
    "^libstdc\\\\+\\\\+"   # baked-into-script: ^libstdc\+\+
    "^libgcc_s")
  set(_NODE_BUNDLE_SEARCH_DIRS_GENEX "${_NODE_BUNDLE_SEARCH_DIRS_GENEX};/usr/lib")
endif()

# Bake the include-pattern list directly into the script body. We avoid
# command-line list passthrough because semicolons + generator
# expressions interact awkwardly. The search-dir list is passed as a
# generator-expression-bearing -D value (resolved at build time so the
# OR-Tools target file dir is correct).
set(_NODE_BUNDLE_INCLUDE_PATTERNS_LITERAL "")
foreach(_p IN LISTS _NODE_BUNDLE_INCLUDE_PATTERNS)
  string(APPEND _NODE_BUNDLE_INCLUDE_PATTERNS_LITERAL "  \"${_p}\"\n")
endforeach()

set(_NODE_BUNDLE_SCRIPT ${CMAKE_CURRENT_BINARY_DIR}/node_bundle_runtime_deps.cmake)
file(WRITE ${_NODE_BUNDLE_SCRIPT} "
# Auto-generated by cmake/node.cmake. Bundles the runtime shared libs
# the .node needs into OUT_DIR. We don't use file(GET_RUNTIME_DEPENDENCIES)
# because on macOS it can't transitively resolve @rpath/ install names
# without the link-time rpaths the .node was built with — which we
# deliberately strip in favour of @loader_path for distribution. Instead
# we glob each SEARCH_DIRS entry for any library matching INCLUDE_PATTERNS,
# which is the entire set the .node could possibly need.

set(INCLUDE_PATTERNS
${_NODE_BUNDLE_INCLUDE_PATTERNS_LITERAL})

if(APPLE)
  set(_lib_glob \"*.dylib\")
else()
  set(_lib_glob \"*.so*\")
endif()

# Each SEARCH_DIRS entry is a directory we glob for libraries.
foreach(_dir IN LISTS SEARCH_DIRS)
  if(NOT IS_DIRECTORY \"\${_dir}\")
    continue()
  endif()
  file(GLOB _entries RELATIVE \"\${_dir}\" \"\${_dir}/\${_lib_glob}\")
  foreach(_cand IN LISTS _entries)
    if(NOT APPLE)
      # Linux: match SONAME-style libfoo.so.X (where X may contain dots,
      # e.g. libabsl_base.so.2508.0.0). Skip the unversioned libfoo.so
      # symlink which is the dev-only alias, and the .so.X.Y.Z realname
      # since file(COPY_FILE) below dereferences symlinks anyway.
      if(NOT _cand MATCHES \"\\\\.so\\\\.[0-9].*\")
        continue()
      endif()
    endif()
    set(_match FALSE)
    foreach(_pat IN LISTS INCLUDE_PATTERNS)
      if(_cand MATCHES \"\${_pat}\")
        set(_match TRUE)
        break()
      endif()
    endforeach()
    if(NOT _match)
      continue()
    endif()
    get_filename_component(_real \"\${_dir}/\${_cand}\" REALPATH)
    if(NOT EXISTS \"\${_real}\")
      continue()
    endif()
    file(COPY_FILE \"\${_real}\" \"\${OUT_DIR}/\${_cand}\"
         ONLY_IF_DIFFERENT)
    message(STATUS \"node bundle: \${_cand} <- \${_real}\")
  endforeach()
endforeach()
")

add_custom_command(TARGET ortools_cpsat_node POST_BUILD
  COMMAND ${CMAKE_COMMAND}
    -DADDON_PATH=$<TARGET_FILE:ortools_cpsat_node>
    "-DSEARCH_DIRS=${_NODE_BUNDLE_SEARCH_DIRS_GENEX}"
    -DOUT_DIR=${NODE_PREBUILDS_DIR}
    -P ${_NODE_BUNDLE_SCRIPT}
  COMMENT "Bundling runtime dependencies for ortools_cpsat_node"
  VERBATIM)

if(APPLE)
  set_property(TARGET ortools_cpsat_node APPEND_STRING PROPERTY
    LINK_FLAGS " -undefined dynamic_lookup -Wl,-dead_strip")
  add_custom_command(TARGET ortools_cpsat_node POST_BUILD
    COMMAND codesign -s - --force $<TARGET_FILE:ortools_cpsat_node>
    VERBATIM)
elseif(UNIX)
  target_link_options(ortools_cpsat_node PRIVATE
    -Wl,--gc-sections
    -Wl,--exclude-libs,ALL
    "-Wl,--version-script=${NODE_PROJECT_DIR}/version.lds")
endif()

# Convenience: build the TS layer too. These targets are best-effort and skip
# if Node 20+ isn't available; the CI/release path uses scripts/prebuild.mjs
# directly.
add_custom_target(node_ts
  COMMAND ${NPM_EXECUTABLE} run build:proto
  COMMAND ${NPM_EXECUTABLE} run build:ts
  WORKING_DIRECTORY ${NODE_PROJECT_DIR}
  COMMENT "Building Node TS layer"
  USES_TERMINAL)

add_custom_target(node_package
  DEPENDS ortools_cpsat_node node_ts
  COMMAND ${CMAKE_COMMAND} -E echo
    "Node package built at ${NODE_PROJECT_DIR}"
  COMMENT "Assembling @ortools-node/cp-sat package")

add_custom_target(node_test
  DEPENDS ortools_cpsat_node
  COMMAND ${NPM_EXECUTABLE} test
  WORKING_DIRECTORY ${NODE_PROJECT_DIR}
  COMMENT "Running Node tests"
  USES_TERMINAL)
