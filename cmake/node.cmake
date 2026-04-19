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

# Locate Node.js + npm. On Windows, `npm` is a `.cmd` launcher and
# execute_process won't invoke a bare `npm` correctly; search for `npm.cmd`
# first so find_program returns the launcher path.
find_program(NODE_EXECUTABLE NAMES node REQUIRED)
if(WIN32)
  find_program(NPM_EXECUTABLE NAMES npm.cmd npm REQUIRED)
else()
  find_program(NPM_EXECUTABLE NAMES npm REQUIRED)
endif()
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
if(WIN32)
  set(NODE_NATIVE_DIR "win32-x64")
  set(NODE_OUTPUT_NAME "node.napi.node")
elseif(APPLE)
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
  set(NODE_NATIVE_DIR "linux-${_NODE_ARCH}")
  if(EXISTS "/etc/alpine-release")
    set(NODE_OUTPUT_NAME "node.napi.musl.node")
    message(WARNING "Node: musl/Alpine detected — prebuilt binaries are not "
                    "shipped for v1; building from source.")
  else()
    set(NODE_OUTPUT_NAME "node.napi.glibc.node")
  endif()
else()
  message(FATAL_ERROR "Node: unsupported platform")
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

if(WIN32)
  list(APPEND NODE_ADDON_SOURCES ${NODE_PROJECT_DIR}/src/cpp/win_delay_load_hook.cc)
endif()

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
set(_NODE_BUNDLE_SCRIPT ${CMAKE_CURRENT_BINARY_DIR}/node_bundle_runtime_deps.cmake)
file(WRITE ${_NODE_BUNDLE_SCRIPT} "
# Auto-generated by cmake/node.cmake. Resolves the .node's runtime
# dependencies and copies them next to the .node.
file(GET_RUNTIME_DEPENDENCIES
  RESOLVED_DEPENDENCIES_VAR _resolved
  UNRESOLVED_DEPENDENCIES_VAR _unresolved
  EXECUTABLES \"\${ADDON_PATH}\"
  DIRECTORIES \"\${LIB_DIR}\"
  PRE_INCLUDE_REGEXES
    \"^libortools\"
    \"^libprotobuf\"
    \"^libabsl_\"
    \"^libutf8_\"
    \"^libre2\"
    \"^libCbc\" \"^libCgl\" \"^libClp\" \"^libCoinUtils\" \"^libOsi\"
    \"^libhighs\" \"^libscip\" \"^libsoplex\"
    \"^libortools\\\\.dylib\" \"^libprotobuf\\\\.dylib\" \"^libabsl_.*\\\\.dylib\"
    \"ortools\\\\.dll\" \"protobuf\\\\.dll\" \"abseil_dll\\\\.dll\"
  PRE_EXCLUDE_REGEXES
    \"^/lib\" \"^/usr/lib\" \"^/usr/local/lib\"
    \"^C:/Windows\"
    \"^/System/Library\" \"^/usr/lib/system\"
    \"^libc\" \"^libm\" \"^libstdc\\\\+\\\\+\" \"^libgcc\" \"^libdl\"
    \"^libpthread\" \"^librt\" \"^libz\" \"^libbz2\"
    \"^ld-linux\" \"^ld-musl\"
    \"^api-ms-win\" \"^ext-ms-win\" \"^kernel32\" \"^vcruntime\"
    \"^msvcp\" \"^ucrtbase\" \"^Concrt\")
foreach(_dep IN LISTS _resolved)
  get_filename_component(_dep_real \${_dep} REALPATH)
  get_filename_component(_dep_soname \${_dep} NAME)
  # Copy the resolved file content under the SONAME the loader expects
  # (e.g. libortools.so.9), not the realname (libortools.so.9.15.0).
  # npm pack does not preserve symlinks so we materialize a real file.
  file(COPY_FILE \"\${_dep_real}\" \"\${OUT_DIR}/\${_dep_soname}\"
       ONLY_IF_DIFFERENT)
  message(STATUS \"node bundle: \${_dep_soname} <- \${_dep_real}\")
endforeach()
foreach(_u IN LISTS _unresolved)
  message(WARNING \"node bundle: unresolved dep \${_u}\")
endforeach()
")

add_custom_command(TARGET ortools_cpsat_node POST_BUILD
  COMMAND ${CMAKE_COMMAND}
    -DADDON_PATH=$<TARGET_FILE:ortools_cpsat_node>
    -DLIB_DIR=$<TARGET_FILE_DIR:${PROJECT_NAMESPACE}::ortools>
    -DOUT_DIR=${NODE_PREBUILDS_DIR}
    -P ${_NODE_BUNDLE_SCRIPT}
  COMMENT "Bundling runtime dependencies for ortools_cpsat_node"
  VERBATIM)

if(WIN32)
  target_link_libraries(ortools_cpsat_node PRIVATE delayimp)
  if(EXISTS "${NODE_API_HEADERS_DIR}/def/node_api.def")
    target_link_libraries(ortools_cpsat_node PRIVATE
      "${NODE_API_HEADERS_DIR}/def/node_api.def")
  endif()
  set_property(TARGET ortools_cpsat_node APPEND_STRING PROPERTY
    LINK_FLAGS " /DELAYLOAD:NODE.EXE")
elseif(APPLE)
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
