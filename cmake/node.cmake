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

# `node-api-headers` ships its .def files under `<root>/def/`, parallel to
# the `<root>/include/` we just resolved. Compute the parent for the
# Windows import-lib generation step below.
get_filename_component(NODE_API_HEADERS_ROOT "${NODE_API_HEADERS_DIR}" DIRECTORY)
message(STATUS "node-api-headers root: ${NODE_API_HEADERS_ROOT}")
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
set(_NODE_BUNDLE_SCRIPT ${CMAKE_CURRENT_BINARY_DIR}/node_bundle_runtime_deps.cmake)
file(WRITE ${_NODE_BUNDLE_SCRIPT} "
# Auto-generated by cmake/node.cmake. Bundles the runtime shared libs
# the .node needs into OUT_DIR. We don't use file(GET_RUNTIME_DEPENDENCIES)
# because on macOS it can't transitively resolve @rpath/ install names
# without the link-time rpaths the .node was built with — which we
# deliberately strip in favour of @loader_path for distribution. Instead
# we glob LIB_DIR for any library that matches the OR-Tools / absl /
# protobuf / re2 family by name, which is the entire set the .node could
# possibly need.

# Pick up libortools and friends in their library extension.
if(WIN32)
  set(_lib_glob \"*.dll\")
elseif(APPLE)
  set(_lib_glob \"*.dylib\")
else()
  set(_lib_glob \"*.so*\")
endif()

file(GLOB _candidates RELATIVE \"\${LIB_DIR}\" \"\${LIB_DIR}/\${_lib_glob}\")

# Deduplicate aliases pointing at the same realpath. The build dir
# typically has libfoo.so -> libfoo.so.X -> libfoo.so.X.Y.Z; we only need
# the SONAME-versioned name (libfoo.so.X) the loader uses, plus the
# realname so that name resolves. file(COPY_FILE) below copies the
# realpath under each candidate name, so just selecting the SONAME-style
# (libfoo.so.X with one trailing version) is sufficient. Drop the
# unversioned and the fully-versioned aliases.
set(_filtered)
foreach(_cand IN LISTS _candidates)
  # Linux: keep libfoo.so.<digit>(.<digit>...) as the SONAME the loader
  # actually requests. Keep .dylib / .dll names unchanged on macOS / Windows.
  if(WIN32 OR APPLE)
    list(APPEND _filtered \"\${_cand}\")
  else()
    # Match SONAME-style libfoo.so.X (where X may contain dots, e.g.
    # libabsl_base.so.2508.0.0). Skip the unversioned libfoo.so symlink
    # which is the dev-only alias.
    if(_cand MATCHES \"\\\\.so\\\\.[0-9].*\")
      list(APPEND _filtered \"\${_cand}\")
    endif()
  endif()
endforeach()
set(_candidates \${_filtered})

set(_INCLUDE_PATTERNS
  \"^libortools\"
  \"^libprotobuf\"
  \"^libabsl_\"
  \"^libutf8_validity\"
  \"^libre2\"
  \"^libCbc\" \"^libCgl\" \"^libClp\" \"^libCoinUtils\" \"^libOsi\"
  \"^libhighs\" \"^libscip\" \"^libsoplex\"
  # OR-Tools' build can produce a bundled libbz2 (on macOS especially);
  # ship it. On Linux we usually link against the system /lib/libbz2,
  # which the LIB_DIR glob won't pick up anyway.
  \"^libbz2\" \"^libz\"
  # Windows DLLs.
  \"^ortools\\\\.dll\" \"^libortools\\\\.dll\"
  \"^libprotobuf\\\\.dll\" \"^libprotoc\\\\.dll\"
  \"^abseil_dll\\\\.dll\" \"^libabsl_\")

foreach(_cand IN LISTS _candidates)
  set(_match FALSE)
  foreach(_pat IN LISTS _INCLUDE_PATTERNS)
    if(_cand MATCHES \"\${_pat}\")
      set(_match TRUE)
      break()
    endif()
  endforeach()
  if(NOT _match)
    continue()
  endif()
  # Skip CMake's symlink alias forms; we want the SONAME-versioned file
  # the loader actually opens. e.g. on Linux libortools.so is the
  # unversioned dev-time symlink, libortools.so.9 is the SONAME the
  # loader uses. We'll keep both: SONAME for runtime + unversioned for
  # rare consumers that link against -lortools at runtime.
  get_filename_component(_real \"\${LIB_DIR}/\${_cand}\" REALPATH)
  if(NOT EXISTS \"\${_real}\")
    continue()
  endif()
  # Skip if we'd be copying a duplicate (same realpath as something we
  # already wrote under a longer name).
  file(COPY_FILE \"\${_real}\" \"\${OUT_DIR}/\${_cand}\"
       ONLY_IF_DIFFERENT)
  message(STATUS \"node bundle: \${_cand} <- \${_real}\")
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
  # Generate node.lib (import library) from node-api-headers' def file
  # so the linker resolves __imp_napi_* / __imp_node_api_* externals
  # against node.exe at link time. The implicit DELAYLOAD below makes
  # resolution actually happen lazily at runtime against whatever host
  # process loaded the .node (node.exe / electron.exe / bun.exe).
  set(_NODE_API_DEF "${NODE_API_HEADERS_ROOT}/def/node_api.def")
  if(NOT EXISTS "${_NODE_API_DEF}")
    message(FATAL_ERROR "node-api-headers: expected def file at ${_NODE_API_DEF}")
  endif()
  set(_NODE_API_LIB "${CMAKE_CURRENT_BINARY_DIR}/node_api.lib")

  # Build the import library at configure time -- it's a tiny operation
  # (lib.exe parses a .def, emits a few hundred byte .lib) and avoids
  # the awkward dance of injecting a generated .lib into a target's
  # link line via add_custom_command, which CMake handles inconsistently.
  if(NOT EXISTS "${_NODE_API_LIB}")
    execute_process(
      COMMAND lib.exe /def:${_NODE_API_DEF} /out:${_NODE_API_LIB} /machine:x64
      RESULT_VARIABLE _lib_result
      OUTPUT_VARIABLE _lib_stdout
      ERROR_VARIABLE _lib_stderr)
    if(NOT _lib_result EQUAL 0)
      message(FATAL_ERROR
        "node-api-headers: lib.exe failed (exit ${_lib_result})\n"
        "stdout:\n${_lib_stdout}\n"
        "stderr:\n${_lib_stderr}")
    endif()
    message(STATUS "node-api-headers: generated ${_NODE_API_LIB}")
  endif()
  target_link_libraries(ortools_cpsat_node PRIVATE "${_NODE_API_LIB}")
  set_property(TARGET ortools_cpsat_node APPEND_STRING PROPERTY
    LINK_FLAGS " /DELAYLOAD:node.exe")
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
