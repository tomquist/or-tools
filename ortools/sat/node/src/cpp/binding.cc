// Copyright 2010-2025 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Top-level Node-API entry point for @ortools-node/cp-sat.
//
// We pin to NAPI version 9 (Node 18.17+ / 20+). The addon ships a single
// exported symbol -- napi_register_module_v1 -- enforced on Linux via the
// version script in ortools/sat/node/version.lds and on Windows via the .def
// file from node-api-headers.

#include <napi.h>

#if NAPI_VERSION < 9
#error "@ortools-node/cp-sat requires NAPI 9 (Node 18.17+ / 20+)"
#endif

namespace operations_research::sat::node_binding {

// Defined in solve_wrapper.cc.
Napi::Object InitSolveWrapper(Napi::Env env, Napi::Object exports);
// Defined in cp_sat_helper.cc.
Napi::Object InitCpSatHelper(Napi::Env env, Napi::Object exports);
// Defined in c_api_binding.cc.
Napi::Object InitCApi(Napi::Env env, Napi::Object exports);

}  // namespace operations_research::sat::node_binding

// NODE_API_MODULE stringifies the second argument, so it must be an
// unqualified identifier. Forward to the namespaced init function here.
static Napi::Object OrtoolsCpsatInit(Napi::Env env, Napi::Object exports) {
  operations_research::sat::node_binding::InitSolveWrapper(env, exports);
  operations_research::sat::node_binding::InitCpSatHelper(env, exports);
  operations_research::sat::node_binding::InitCApi(env, exports);
  return exports;
}

NODE_API_MODULE(ortools_cpsat_node, OrtoolsCpsatInit)
